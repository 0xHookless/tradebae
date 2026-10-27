import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from .config import settings, BASE_DIR
from .database import engine, Base, SessionLocal
from .models import AdminUser, Software, Release
from .services.auth import hash_password
from .routers import auth, software, releases, downloads, licenses, audit, clientupdate

Base.metadata.create_all(bind=engine)

# Lightweight migration for new columns on existing SQLite DBs
from sqlalchemy import text
with engine.begin() as _conn:
    for _col, _ddl in [("r2_key", "VARCHAR"), ("zip_sha256", "VARCHAR"), ("zip_size", "INTEGER")]:
        try:
            _conn.execute(text(f"ALTER TABLE releases ADD COLUMN {_col} {_ddl}"))
        except Exception:
            pass  # column already exists
    for _col, _ddl in [("failed_attempts", "INTEGER DEFAULT 0"), ("locked_until", "DATETIME")]:
        try:
            _conn.execute(text(f"ALTER TABLE admin_users ADD COLUMN {_col} {_ddl}"))
        except Exception:
            pass  # column already exists
    for _col, _ddl in [("launch_mode", "VARCHAR"), ("local_stack", "BOOLEAN DEFAULT 0")]:
        try:
            _conn.execute(text(f"ALTER TABLE software ADD COLUMN {_col} {_ddl}"))
        except Exception:
            pass  # column already exists
    _conn.execute(text("UPDATE software SET local_stack = 1 WHERE slug IN ('deepcharts', 'motivewave')"))
    # DeepCharts (and MotiveWave) launch through the local data stack, which the client only
    # starts in "ghost" launch mode. Seed that default without clobbering a deliberate admin
    # change, so a fresh database still starts the proxy on launch.
    _conn.execute(text("UPDATE software SET launch_mode = 'ghost' WHERE slug IN ('deepcharts', 'motivewave') AND (launch_mode IS NULL OR launch_mode = '')"))

DEFAULT_SOFTWARE = [
    ("atas", "ATAS", "ATAS trading platform", "ATAS", "ATAS.exe", "", True),
    ("atas-x", "ATAS X", "ATAS X trading platform", "ATAS X", "ATASX.exe", "", True),
    ("bookmap", "Bookmap", "Bookmap order flow", "Bookmap", "Bookmap.exe", "", True),
    ("motivewave", "MotiveWave", "MotiveWave trading", "MotiveWave", "MotiveWave.exe", "", True),
    ("sierra-chart", "Sierra Chart", "Sierra Chart trading", "SierraChart", "SierraChart_64.exe", "", True),
    ("deepcharts", "DeepCharts", "DeepCharts trading platform", "DeepCharts", "Deepchart.Core.exe", "", True),
]

@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        if not db.query(AdminUser).filter(AdminUser.username == settings.admin_bootstrap_username).first():
            u = AdminUser(username=settings.admin_bootstrap_username, password_hash=hash_password(settings.admin_bootstrap_password))
            db.add(u)
            db.commit()
        for slug, name, desc, dirn, exe, args, sep in DEFAULT_SOFTWARE:
            if not db.query(Software).filter(Software.slug == slug).first():
                db.add(Software(slug=slug, display_name=name, description=desc, install_dir_name=dirn, executable_name=exe, launch_args=args, separate_executable=sep))
        db.commit()
    finally:
        db.close()
    yield

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests"})

app.add_middleware(CORSMiddleware,
                   allow_origins=["*"] if settings.cors_origins.strip() in ("*", "") else [o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                   allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])

# Simple security headers on every response (API + admin SPA)
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
       "form-action 'self'; frame-ancestors 'none'; base-uri 'self'")

class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                ctype = next((v.decode("latin-1") for k, v in message.get("headers", []) if k == b"content-type"), "")
                extra = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                ]
                if ctype.startswith("text/html"):
                    extra.append((b"content-security-policy", CSP.encode()))
                message["headers"] = list(message.get("headers", [])) + extra
            await send(message)
        await self.app(scope, receive, send_wrapper)

app.add_middleware(SecurityHeadersMiddleware)

# Per-client-IP rate limiting (works behind the Cloudflare tunnel via CF-Connecting-IP).
from .ratelimit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router)
app.include_router(software.router)
app.include_router(releases.router)
app.include_router(downloads.router)
app.include_router(licenses.router)
app.include_router(audit.router)
app.include_router(clientupdate.router)

# serve admin SPA if built
ADMIN_DIR = BASE_DIR.parent / "admin" / "dist"
if ADMIN_DIR.exists():
    app.mount("/admin/assets", StaticFiles(directory=str(ADMIN_DIR / "assets")), name="adminassets")
    @app.get("/admin/{full_path:path}")
    def admin_spa(full_path: str):
        f = ADMIN_DIR / full_path
        if f.is_file():
            return FileResponse(str(f))
        return FileResponse(str(ADMIN_DIR / "index.html"))
    @app.get("/admin")
    def admin_root():
        return FileResponse(str(ADMIN_DIR / "index.html"))

@app.get("/")
def root():
    return {"name": settings.app_name, "status": "ok"}
