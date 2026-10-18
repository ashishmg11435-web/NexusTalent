"""
NexusTalent — Talent Router
Candidate user authentication (Sign Up, Sign In, Session Validation),
Profile management, Redis-cached job matching, and Job applications.
"""

import hashlib
import json
import secrets
from datetime import datetime
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Header, Depends, status

from config.database import (
    profiles_collection,
    jobs_collection,
    applications_collection,
    redis_client,
)
from models.schemas import (
    UserSignup,
    UserLogin,
    ProfileCreate,
    ProfileUpdate,
    ApplicationCreate,
)

router = APIRouter()

# ── Cache & Session TTL ──────────────────────────────────────
JOBS_CACHE_TTL = 300       # 5 minutes
SESSION_TTL = 604800       # 7 days


# ═══════════════════════════════════════════════════════════
# HELPER: Document Serialization & Sanitization
# ═══════════════════════════════════════════════════════════
def serialize_doc(doc: dict) -> dict:
    """Convert MongoDB document to JSON-safe dict."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


def serialize_list(cursor) -> list:
    """Convert a MongoDB cursor to a list of JSON-safe dicts."""
    return [serialize_doc(doc) for doc in cursor]


def sanitize_user(user: dict) -> dict:
    """Strip sensitive fields before returning to client."""
    if not user:
        return {}
    clean = serialize_doc(dict(user))
    clean.pop("password_hash", None)
    clean.pop("sessions", None)
    return clean


# ═══════════════════════════════════════════════════════════
# SECURITY: Password Hashing (PBKDF2-HMAC-SHA256)
# ═══════════════════════════════════════════════════════════
def hash_password(password: str) -> str:
    """Hash password using standard PBKDF2-HMAC-SHA256 with 16-byte random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        100000
    ).hex()
    return f"{salt}:{key}"


def verify_password(stored_hash: str, password: str) -> bool:
    """Verify password against stored salt:hash string."""
    try:
        salt, key = stored_hash.split(":")
        test_key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            100000
        ).hex()
        return secrets.compare_digest(key, test_key)
    except Exception:
        return False


# ═══════════════════════════════════════════════════════════
# SESSION ENGINE (Redis + MongoDB fallback)
# ═══════════════════════════════════════════════════════════
def create_session(email: str) -> str:
    """Generate session token and register in Redis & MongoDB."""
    token = secrets.token_urlsafe(32)
    # 1. Cache in Redis
    try:
        redis_client.setex(f"nexustalent:session:{token}", SESSION_TTL, email)
    except Exception:
        pass
    # 2. Persist in MongoDB
    try:
        profiles_collection.update_one(
            {"email": email},
            {"$addToSet": {"sessions": token}}
        )
    except Exception:
        pass
    return token


def revoke_session(token: str, email: Optional[str] = None):
    """Revoke a session token from Redis and MongoDB."""
    try:
        redis_client.delete(f"nexustalent:session:{token}")
    except Exception:
        pass
    try:
        query = {"email": email} if email else {"sessions": token}
        profiles_collection.update_one(query, {"$pull": {"sessions": token}})
    except Exception:
        pass


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Dependency: Extract and validate Bearer token; return candidate profile."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:].strip()
    email = None

    # Try Redis session lookup
    try:
        email = redis_client.get(f"nexustalent:session:{token}")
    except Exception:
        pass

    # Fallback to MongoDB session lookup
    if email:
        user = profiles_collection.find_one({"email": email})
    else:
        user = profiles_collection.find_one({"sessions": token})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Dependency: Return authenticated user if token is valid, otherwise None."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


# ═══════════════════════════════════════════════════════════
# AUTHENTICATION ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.post("/auth/signup", status_code=status.HTTP_201_CREATED)
async def signup(data: UserSignup):
    """Register a new candidate user account with password & profile."""
    email = data.email.lower().strip()
    existing = profiles_collection.find_one({"email": email})

    if existing and existing.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists. Please sign in."
        )

    pwd_hash = hash_password(data.password)
    now = datetime.utcnow().isoformat()

    if existing:
        # Upgrade legacy/unprotected profile
        update_doc = {
            "name": data.name.strip(),
            "password_hash": pwd_hash,
            "skills": data.skills or existing.get("skills", []),
            "experience": data.experience if data.experience is not None else existing.get("experience", 0),
            "location": data.location or existing.get("location", ""),
            "bio": data.bio or existing.get("bio", ""),
            "updated_at": now
        }
        profiles_collection.update_one({"email": email}, {"$set": update_doc})
        user = profiles_collection.find_one({"email": email})
    else:
        # Create brand-new profile
        user = {
            "name": data.name.strip(),
            "email": email,
            "password_hash": pwd_hash,
            "skills": data.skills or [],
            "experience": data.experience or 0,
            "location": data.location or "",
            "bio": data.bio or "",
            "sessions": [],
            "created_at": now,
            "updated_at": now
        }
        res = profiles_collection.insert_one(user)
        user["_id"] = res.inserted_id

    token = create_session(email)
    return {
        "message": "Account created successfully",
        "token": token,
        "profile": sanitize_user(user)
    }


@router.post("/auth/login")
async def login(data: UserLogin):
    """Authenticate candidate credentials and issue a session token."""
    email = data.email.lower().strip()
    user = profiles_collection.find_one({"email": email})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No account found with this email. Please sign up first."
        )

    stored_hash = user.get("password_hash")
    if not stored_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This profile does not have a password set. Please sign up to secure your account."
        )

    if not verify_password(stored_hash, data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again."
        )

    token = create_session(email)
    return {
        "message": "Login successful",
        "token": token,
        "profile": sanitize_user(user)
    }


@router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Fetch profile data and application count for current authenticated user."""
    apps_count = applications_collection.count_documents({"email": user["email"]})
    return {
        "profile": sanitize_user(user),
        "applications_count": apps_count
    }


@router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Revoke session token on sign out."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        revoke_session(token)
    return {"message": "Logged out successfully"}


# ═══════════════════════════════════════════════════════════
# PROFILE CRUD ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.put("/profile")
async def update_my_profile(profile: ProfileUpdate, user: dict = Depends(get_current_user)):
    """Update profile data for the authenticated candidate."""
    email = user["email"]
    update_data = {k: v for k, v in profile.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update."
        )

    update_data["updated_at"] = datetime.utcnow().isoformat()
    profiles_collection.update_one({"email": email}, {"$set": update_data})

    updated = profiles_collection.find_one({"email": email})
    return {
        "message": "Profile saved successfully",
        "profile": sanitize_user(updated)
    }


@router.get("/profile/me")
async def get_my_profile(user: dict = Depends(get_current_user)):
    """Retrieve the authenticated candidate's saved profile."""
    return sanitize_user(user)


@router.post("/profile", status_code=status.HTTP_201_CREATED)
async def create_profile_legacy(profile: ProfileCreate):
    """Direct profile creation with optional password."""
    email = profile.email.lower().strip()
    existing = profiles_collection.find_one({"email": email})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A profile with this email already exists. Please sign in."
        )

    doc = profile.model_dump()
    pwd = doc.pop("password", None)
    if pwd:
        doc["password_hash"] = hash_password(pwd)
    now = datetime.utcnow().isoformat()
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["sessions"] = []

    res = profiles_collection.insert_one(doc)
    doc["_id"] = res.inserted_id

    token = create_session(email) if pwd else None
    return {
        "message": "Profile created successfully",
        "token": token,
        "profile": sanitize_user(doc)
    }


@router.get("/profile/{email}")
async def get_profile_by_email(email: str):
    """Public read-only profile lookup."""
    profile = profiles_collection.find_one({"email": email.lower().strip()})
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found."
        )
    return sanitize_user(profile)


# ═══════════════════════════════════════════════════════════
# JOB LISTING ENDPOINTS (with Redis caching)
# ═══════════════════════════════════════════════════════════

@router.get("/jobs")
async def list_jobs():
    """List all available jobs. Results are cached in Redis."""
    cache_key = "nexustalent:jobs:all"

    # Try Redis cache first
    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass  # Redis down — fallback to MongoDB

    jobs = serialize_list(jobs_collection.find().sort("posted_date", -1))

    # Store in Redis cache
    try:
        redis_client.setex(cache_key, JOBS_CACHE_TTL, json.dumps(jobs))
    except Exception:
        pass

    return jobs


@router.get("/jobs/match")
async def match_jobs(skills: str):
    """Find jobs matching candidate skills."""
    skill_list = [s.strip().lower() for s in skills.split(",") if s.strip()]
    if not skill_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide at least one skill."
        )

    cache_key = f"nexustalent:jobs:match:{','.join(sorted(skill_list))}"

    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    regex_patterns = [{"skills": {"$elemMatch": {"$regex": f"^{s}$", "$options": "i"}}} for s in skill_list]
    query = {"$or": regex_patterns} if regex_patterns else {}

    matched_jobs = serialize_list(jobs_collection.find(query).sort("posted_date", -1))

    try:
        redis_client.setex(cache_key, JOBS_CACHE_TTL, json.dumps(matched_jobs))
    except Exception:
        pass

    return matched_jobs


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get a single job by ID."""
    try:
        job = jobs_collection.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job ID.")

    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    return serialize_doc(job)


# ═══════════════════════════════════════════════════════════
# JOB APPLICATION ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.post("/jobs/{job_id}/apply", status_code=status.HTTP_201_CREATED)
async def apply_to_job(
    job_id: str,
    application: ApplicationCreate,
    current_user: Optional[dict] = Depends(get_optional_user)
):
    """Submit an application for a specific job."""
    # Determine candidate email
    email = None
    if current_user:
        email = current_user.get("email")
    elif application.email:
        email = application.email.lower().strip()

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address is required. Please sign in or provide your email."
        )

    # Validate job exists
    try:
        job = jobs_collection.find_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job ID.")

    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    # Check for duplicate application
    existing = applications_collection.find_one({
        "job_id": job_id,
        "email": email
    })
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already applied to this job."
        )

    # Lookup profile data to attach candidate snapshot
    profile = current_user or profiles_collection.find_one({"email": email})

    app_doc = {
        "job_id": job_id,
        "job_title": job.get("title", ""),
        "company": job.get("company", ""),
        "email": email,
        "name": profile.get("name", "") if profile else "",
        "skills": profile.get("skills", []) if profile else [],
        "cover_letter": application.cover_letter or "",
        "status": "Pending",
        "applied_date": datetime.utcnow().isoformat()
    }

    result = applications_collection.insert_one(app_doc)
    app_doc["_id"] = str(result.inserted_id)

    return {"message": "Application submitted successfully", "application": app_doc}


@router.get("/applications/my")
async def get_my_applications(user: dict = Depends(get_current_user)):
    """Retrieve all applications for the authenticated candidate."""
    apps = serialize_list(
        applications_collection.find({"email": user["email"]}).sort("applied_date", -1)
    )
    return apps


@router.get("/applications/{email}")
async def get_applications_by_email(email: str):
    """Retrieve all applications submitted by candidate email."""
    apps = serialize_list(
        applications_collection.find({"email": email.lower().strip()}).sort("applied_date", -1)
    )
    return apps
