"""
NexusTalent — API Kernel Bootstrap
Mounts static files, Jinja2 templates, CORS middleware,
and includes route modules for talent & admin endpoints.
"""

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

# ── App Instance ─────────────────────────────────────────────
app = FastAPI(
    title="NexusTalent",
    description="High-performance talent marketplace & profile-matching ecosystem",
    version="1.0.0"
)

from pymongo.errors import PyMongoError, ServerSelectionTimeoutError
from fastapi.responses import JSONResponse

# ── Global Database Exception Handlers ───────────────────────
@app.exception_handler(ServerSelectionTimeoutError)
async def mongo_timeout_handler(request: Request, exc: ServerSelectionTimeoutError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database connection timed out. Please check your network connection, MongoDB Atlas IP whitelist (allow 0.0.0.0/0), or if port 27017 is blocked by your firewall/Wi-Fi."
        }
    )

@app.exception_handler(PyMongoError)
async def mongo_error_handler(request: Request, exc: PyMongoError):
    return JSONResponse(
        status_code=503,
        content={"detail": f"Database error: {str(exc)}"}
    )

# ── CORS Middleware ──────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static Files & Templates ────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# ── Template Routes ──────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def index(request: Request):
    """Serve the candidate marketplace portal."""
    return templates.TemplateResponse(request, "index.html")


@app.get("/admin", include_in_schema=False)
async def admin(request: Request):
    """Serve the recruiter admin portal."""
    return templates.TemplateResponse(request, "admin.html")


# ── API Route Includes ───────────────────────────────────────
from routes.talent import router as talent_router
from routes.admin import router as admin_router
app.include_router(talent_router, prefix="/api/talent", tags=["Talent"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])

