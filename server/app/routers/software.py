from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import Software, Release, AuditLog
from ..schemas import SoftwareCreate, SoftwareOut, ReleaseOut
from .auth import get_current_admin

router = APIRouter(prefix="/software", tags=["software"])

def _latest_version(db, sw):
    r = db.query(Release).filter(Release.software_id == sw.id, Release.published == True).order_by(Release.created_at.desc()).first()
    return r.version if r else None

@router.get("", response_model=List[SoftwareOut])
def list_software(db: Session = Depends(get_db)):
    items = db.query(Software).all()
    out = []
    for sw in items:
        so = SoftwareOut.from_orm(sw)
        so.latest_version = _latest_version(db, sw)
        out.append(so)
    return out

@router.get("/{slug}")
def get_software(slug: str, db: Session = Depends(get_db)):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Software not found")
    so = SoftwareOut.from_orm(sw)
    so.latest_version = _latest_version(db, sw)
    return so

@router.post("", response_model=SoftwareOut)
def create_software(data: SoftwareCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if db.query(Software).filter(Software.slug == data.slug).first():
        raise HTTPException(400, "Slug exists")
    sw = Software(**{k: v for k, v in data.dict().items() if v is not None})
    db.add(sw)
    db.add(AuditLog(actor=admin.username, action="create_software", target=data.slug, detail="created"))
    db.commit()
    db.refresh(sw)
    so = SoftwareOut.from_orm(sw)
    so.latest_version = None
    return so

@router.put("/{slug}", response_model=SoftwareOut)
def update_software(slug: str, data: SoftwareCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Not found")
    for k,v in data.dict().items():
        if v is None:
            continue  # absent fields keep their current value
        setattr(sw, k, v)
    db.add(AuditLog(actor=admin.username, action="update_software", target=slug, detail="updated"))
    db.commit()
    db.refresh(sw)
    so = SoftwareOut.from_orm(sw)
    so.latest_version = _latest_version(db, sw)
    return so

@router.delete("/{slug}")
def delete_software(slug: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Not found")
    db.delete(sw)
    db.add(AuditLog(actor=admin.username, action="delete_software", target=slug, detail="deleted"))
    db.commit()
    return {"ok": True}
