"""
NexusTalent — Admin Router
HTTP Basic Auth protected endpoints for job management,
applicant review, and dashboard statistics.
"""

import os
import json
import secrets
from datetime import datetime

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from config.database import (
    jobs_collection,
    profiles_collection,
    applications_collection,
    redis_client,
)
from models.schemas import JobCreate, JobUpdate

load_dotenv()

router = APIRouter()
security = HTTPBasic()

# ── Admin Credentials from .env ──────────────────────────────
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")


# ═══════════════════════════════════════════════════════════
# AUTH DEPENDENCY
# ═══════════════════════════════════════════════════════════
def verify_admin(credentials: HTTPBasicCredentials = Depends(security)):
    """Validate HTTP Basic Auth credentials against environment variables."""
    correct_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)

    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ═══════════════════════════════════════════════════════════
# HELPER: Serialize MongoDB documents
# ═══════════════════════════════════════════════════════════
def serialize_doc(doc: dict) -> dict:
    """Convert MongoDB document to JSON-safe dict."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


def serialize_list(cursor) -> list:
    """Convert a MongoDB cursor to a list of JSON-safe dicts."""
    return [serialize_doc(doc) for doc in cursor]


def invalidate_jobs_cache():
    """Clear all cached job data from Redis."""
    try:
        keys = redis_client.keys("nexustalent:jobs:*")
        if keys:
            redis_client.delete(*keys)
    except Exception:
        pass  # Non-critical


# ═══════════════════════════════════════════════════════════
@router.get("/verify")
async def verify_login(admin: str = Depends(verify_admin)):
    """Verify HTTP Basic Auth credentials directly without requiring DB access."""
    return {"status": "authenticated", "admin": admin}


@router.get("/jobs")
async def list_admin_jobs(admin: str = Depends(verify_admin)):
    """List all job postings (admin view)."""
    jobs = serialize_list(jobs_collection.find().sort("posted_date", -1))
    return jobs


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(job: JobCreate, admin: str = Depends(verify_admin)):
    """Create a new job posting."""
    doc = job.model_dump()
    doc["posted_date"] = datetime.utcnow().isoformat()
    doc["created_by"] = admin

    result = jobs_collection.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    # Invalidate Redis cache so new job appears in listings
    invalidate_jobs_cache()

    return {"message": "Job published successfully", "job": doc}


@router.put("/jobs/{job_id}")
async def update_job(job_id: str, job: JobUpdate, admin: str = Depends(verify_admin)):
    """Update an existing job posting."""
    update_data = {k: v for k, v in job.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update."
        )

    update_data["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = jobs_collection.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": update_data}
        )
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job ID.")

    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    updated = jobs_collection.find_one({"_id": ObjectId(job_id)})
    invalidate_jobs_cache()

    return {"message": "Job updated successfully", "job": serialize_doc(updated)}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, admin: str = Depends(verify_admin)):
    """Delete a job posting and its associated applications."""
    try:
        result = jobs_collection.delete_one({"_id": ObjectId(job_id)})
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job ID.")

    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    # Also clean up applications for this job
    applications_collection.delete_many({"job_id": job_id})
    invalidate_jobs_cache()

    return {"message": "Job deleted successfully"}


# ═══════════════════════════════════════════════════════════
# APPLICANT MANAGEMENT ENDPOINTS
# ═══════════════════════════════════════════════════════════

@router.get("/applicants")
async def list_applicants(admin: str = Depends(verify_admin)):
    """List all job applications across all postings."""
    apps = serialize_list(
        applications_collection.find().sort("applied_date", -1)
    )
    return apps


@router.put("/applicants/{application_id}/status")
async def update_application_status(
    application_id: str,
    new_status: str,
    admin: str = Depends(verify_admin)
):
    """Update the status of a job application (e.g. Reviewing, Accepted, Rejected)."""
    valid_statuses = ["Pending", "Reviewing", "Accepted", "Rejected", "Hired"]
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )

    try:
        result = applications_collection.update_one(
            {"_id": ObjectId(application_id)},
            {"$set": {"status": new_status, "updated_at": datetime.utcnow().isoformat()}}
        )
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid application ID.")

    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")

    return {"message": f"Application status updated to '{new_status}'"}


# ═══════════════════════════════════════════════════════════
# DASHBOARD STATISTICS
# ═══════════════════════════════════════════════════════════

@router.get("/stats")
async def get_dashboard_stats(admin: str = Depends(verify_admin)):
    """Return aggregate counts for the admin dashboard."""
    total_jobs = jobs_collection.count_documents({})
    total_applicants = applications_collection.count_documents({})
    total_profiles = profiles_collection.count_documents({})

    return {
        "jobs": total_jobs,
        "applicants": total_applicants,
        "profiles": total_profiles
    }
