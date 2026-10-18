"""
NexusTalent — Global Database Engine Setup
MongoClient (pymongo) and Redis (from_url) initialization.
Connections are loaded from environment variables via python-dotenv.
"""

import os
from dotenv import load_dotenv
from pymongo import MongoClient
import redis

load_dotenv()

# ── MongoDB Atlas ────────────────────────────────────────────
MONGODB_URL = os.getenv("MONGODB_URL")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "nexustalent")

mongo_client = MongoClient(
    MONGODB_URL,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=5000,
)
db = mongo_client[MONGODB_DB_NAME]

# Collections
profiles_collection = db["profiles"]
jobs_collection = db["jobs"]
applications_collection = db["applications"]

# ── Redis Cloud (from_url) ───────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL")

redis_client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=3,
    socket_timeout=3,
)
