from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address
from ..database import get_db
from ..models import AdminUser, AuditLog
from ..schemas import LoginRequest, ChangePasswordRequest, TokenResponse
from ..services.auth import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from ..services.crypto import get_public_key_pem
from ..config import settings
from datetime import datetime, timedelta
import uuid

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

MAX_FAILED_ATTEMPTS = 10
LOCKOUT_MINUTES = 15

def get_current_admin(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = db.query(AdminUser).filter(AdminUser.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive")
    return user

@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.rate_limit_login)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(AdminUser).filter(AdminUser.username == req.username).first()
    now = datetime.utcnow()
    if user and user.locked_until and user.locked_until > now:
        db.add(AuditLog(actor=req.username, action="login_locked", target="auth", detail="attempt during lockout"))
        db.commit()
        raise HTTPException(status_code=429, detail="Account temporarily locked; try again later")
    if not user or not verify_password(req.password, user.password_hash):
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_attempts = 0
                db.add(AuditLog(actor=req.username, action="login_locked", target="auth", detail=f"locked for {LOCKOUT_MINUTES} minutes after {MAX_FAILED_ATTEMPTS} failed attempts"))
            else:
                remaining = MAX_FAILED_ATTEMPTS - user.failed_attempts
                db.add(AuditLog(actor=req.username, action="login_failed", target="auth", detail=f"invalid credentials; {remaining} attempts remaining"))
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login = now
    db.commit()
    db.add(AuditLog(actor=user.username, action="login", target="auth", detail="admin login"))
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id), refresh_token=create_refresh_token(user.id))

@router.post("/refresh", response_model=TokenResponse)
def refresh(refresh_token: str, db: Session = Depends(get_db)):
    try:
        payload = decode_token(refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = db.query(AdminUser).filter(AdminUser.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive")
    return TokenResponse(access_token=create_access_token(user.id), refresh_token=create_refresh_token(user.id))

@router.get("/me")
def me(user: AdminUser = Depends(get_current_admin)):
    return {"id": user.id, "username": user.username}

@router.post("/change-password")
def change_password(data: ChangePasswordRequest, db: Session = Depends(get_db), user: AdminUser = Depends(get_current_admin)):
    if not verify_password(data.old_password, user.password_hash):
        db.add(AuditLog(actor=user.username, action="change_password", target="auth", detail="failed: wrong current password"))
        db.commit()
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(data.new_password) < 10:
        raise HTTPException(status_code=400, detail="New password must be at least 10 characters")
    user.password_hash = hash_password(data.new_password)
    db.add(AuditLog(actor=user.username, action="change_password", target="auth", detail="password changed"))
    db.commit()
    return {"ok": True}

@router.get("/public-key")
def public_key():
    return {"public_key_pem": get_public_key_pem()}
