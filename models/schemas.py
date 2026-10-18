"""
NexusTalent — Pydantic Schemas for Structural Type-Safety
Defines request/response models for authentication, profiles, jobs, and applications.
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


# ═══════════════════════════════════════════════════════════
# AUTHENTICATION & CANDIDATE USER SCHEMAS
# ═══════════════════════════════════════════════════════════
class UserSignup(BaseModel):
    """Schema for candidate registration (Sign Up)."""
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=6, max_length=128)
    skills: Optional[List[str]] = Field(default_factory=list)
    experience: Optional[int] = Field(default=0, ge=0, le=50)
    location: Optional[str] = None
    bio: Optional[str] = None


class UserLogin(BaseModel):
    """Schema for candidate login (Sign In)."""
    email: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=1)


# ═══════════════════════════════════════════════════════════
# PROFILE SCHEMAS
# ═══════════════════════════════════════════════════════════
class ProfileCreate(BaseModel):
    """Legacy/direct schema for creating a new candidate profile."""
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=150)
    password: Optional[str] = Field(None, min_length=6, max_length=128)
    skills: List[str] = Field(default_factory=list)
    experience: int = Field(default=0, ge=0, le=50)
    location: Optional[str] = None
    bio: Optional[str] = None


class ProfileUpdate(BaseModel):
    """Schema for updating an existing candidate profile."""
    name: Optional[str] = None
    skills: Optional[List[str]] = None
    experience: Optional[int] = Field(None, ge=0, le=50)
    location: Optional[str] = None
    bio: Optional[str] = None


# ═══════════════════════════════════════════════════════════
# JOB SCHEMAS
# ═══════════════════════════════════════════════════════════
class JobCreate(BaseModel):
    """Schema for creating a new job posting."""
    title: str = Field(..., min_length=1, max_length=200)
    company: str = Field(..., min_length=1, max_length=150)
    location: Optional[str] = None
    job_type: Optional[str] = "Full-time"
    salary: Optional[str] = None
    skills: List[str] = Field(..., min_length=1)
    description: Optional[str] = None


class JobUpdate(BaseModel):
    """Schema for updating an existing job posting."""
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    job_type: Optional[str] = None
    salary: Optional[str] = None
    skills: Optional[List[str]] = None
    description: Optional[str] = None


# ═══════════════════════════════════════════════════════════
# APPLICATION SCHEMAS
# ═══════════════════════════════════════════════════════════
class ApplicationCreate(BaseModel):
    """Schema for submitting a job application."""
    email: Optional[str] = Field(None, min_length=3, max_length=150)
    cover_letter: Optional[str] = None
