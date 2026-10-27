from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import AuditLog
from ..schemas import AuditOut
from .auth import get_current_admin

router = APIRouter(tags=["audit"])

@router.get("/audit", response_model=list[AuditOut])
def list_audit(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()

@router.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}
