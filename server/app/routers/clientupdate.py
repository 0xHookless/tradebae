import hashlib, os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import ClientRelease, AuditLog
from ..services.storage import save_encrypted_file, read_decrypted_file, delete_file
from .auth import get_current_admin

router = APIRouter(tags=["client-update"])

def _latest(db: Session):
    return (db.query(ClientRelease)
            .filter(ClientRelease.published == True)
            .order_by(ClientRelease.created_at.desc())
            .first())

@router.get("/client-update")
def client_update(db: Session = Depends(get_db)):
    rel = _latest(db)
    if not rel:
        raise HTTPException(404, "No update available")
    return {"version": rel.version, "notes": rel.notes,
            "url": "/client-update/bin", "sha256": rel.sha256, "size": rel.size}

@router.get("/client-update/bin")
def client_update_bin(db: Session = Depends(get_db)):
    rel = _latest(db)
    if not rel:
        raise HTTPException(404, "No update available")
    data = read_decrypted_file(rel.storage_name)
    return Response(content=data, media_type="application/vnd.microsoft.portable-executable",
                    headers={"Content-Disposition": f'attachment; filename="TradeBayInstaller-{rel.version}.exe"'})

@router.post("/client-update")
async def upload_client_update(file: UploadFile = File(...), version: str = Form(...),
                               notes: str = Form(""), db: Session = Depends(get_db),
                               admin=Depends(get_current_admin)):
    filename = (file.filename or "").strip()
    if not filename.lower().endswith(".exe"):
        raise HTTPException(400, "The client update must be the Trade Bay installer (.exe)")
    data = await file.read()
    if len(data) < 1024:
        raise HTTPException(400, "File too small")
    if data[:2] != b"MZ":
        raise HTTPException(400, "The file is not a Windows executable (missing MZ header)")
    version = version.strip()
    if not version:
        raise HTTPException(400, "Version is required")
    for old in db.query(ClientRelease).filter(ClientRelease.published == True).all():
        delete_file(old.storage_name)
        old.published = False
    db.flush()
    storage_name, size, sha = save_encrypted_file(data)
    rel = ClientRelease(version=version, notes=notes, storage_name=storage_name,
                        sha256=sha, size=size, published=True)
    db.add(rel)
    db.add(AuditLog(actor=admin.username, action="upload_client_update",
                    target=f"client@{version}", detail=f"size={size} sha={sha[:12]}"))
    db.commit()
    return {"ok": True, "version": rel.version, "sha256": rel.sha256, "size": rel.size}
