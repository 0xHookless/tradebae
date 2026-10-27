import os, hashlib, json, base64, tempfile
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Software, Release, ReleaseFile, AuditLog
from ..schemas import ReleaseCreate, ReleaseOut
from ..services.storage import save_encrypted_file, delete_file
from ..services.crypto import sign_manifest, get_public_key_pem
from ..services.exclusions import validate_upload
from ..services.r2 import build_zip, upload_zip, r2_enabled, presigned_put_url
from ..config import settings, BASE_DIR, STORAGE_DIR
from .auth import get_current_admin

router = APIRouter(tags=["releases"])

def validate_relpath(p: str):
    if not p or p.startswith("/") or ".." in p.split("/") or ".." in p.split("\\"):
        raise HTTPException(400, "Invalid relative path")
    # normalize separators
    p = p.replace("\\", "/")
    if ":" in p:
        raise HTTPException(400, "Invalid path")
    return p

@router.post("/releases/{slug}", response_model=ReleaseOut)
def create_release(slug: str, data: ReleaseCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Software not found")
    if db.query(Release).filter(Release.software_id == sw.id, Release.version == data.version).first():
        raise HTTPException(400, "Duplicate version")
    rel = Release(software_id=sw.id, version=data.version, manifest_version=1)
    db.add(rel)
    db.add(AuditLog(actor=admin.username, action="create_release", target=f"{slug}@{data.version}", detail="draft created"))
    db.commit()
    db.refresh(rel)
    return rel

@router.get("/releases/{slug}")
def list_releases(slug: str, db: Session = Depends(get_db)):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Software not found")
    rels = db.query(Release).filter(Release.software_id == sw.id).order_by(Release.created_at.desc()).all()
    return [{"id": r.id, "version": r.version, "published": r.published, "published_at": r.published_at, "total_size": r.total_size, "created_at": r.created_at, "file_count": len(r.files)} for r in rels]

@router.get("/release/{release_id}")
def get_release(release_id: str, db: Session = Depends(get_db)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    return {
        "id": rel.id,
        "software_id": rel.software_id,
        "version": rel.version,
        "published": rel.published,
        "published_at": rel.published_at,
        "total_size": rel.total_size,
        "files": [{"id": f.id, "relative_path": f.relative_path, "size": f.size, "sha256": f.sha256, "role": f.role, "required": f.required} for f in rel.files],
    }

@router.post("/release/{release_id}/upload")
async def upload_file(release_id: str, file: UploadFile = File(...), relative_path: str = Form(...), role: str = Form("normal"), required: bool = Form(True), db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    rp = validate_relpath(relative_path)
    if role != "executable" and db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role != "executable", ReleaseFile.storage_name == "").first():
        raise HTTPException(400, "This release uses a package zip. Replace the zip, or remove it, before adding single files.")
    # duplicate check
    existing = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.relative_path == rp).first()
    if existing:
        raise HTTPException(400, "Duplicate relative path in release")
    data = await file.read()
    err = validate_upload(rp, role, len(data))
    if err:
        raise HTTPException(400, err)
    storage_name, size, sha = save_encrypted_file(data)
    rf = ReleaseFile(release_id=release_id, relative_path=rp, size=size, sha256=sha, role=role, required=required, storage_name=storage_name)
    db.add(rf)
    db.add(AuditLog(actor=admin.username, action="upload_file", target=f"{release_id}:{rp}", detail=f"size={size} role={role}"))
    db.commit()
    db.refresh(rf)
    return {"id": rf.id, "relative_path": rf.relative_path, "size": rf.size, "sha256": rf.sha256, "role": rf.role, "required": rf.required}

@router.post("/release/{release_id}/payload")
async def upload_payload(release_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """The managed executable the launcher loads. One per release, encrypted at rest, never part of the package zip.
    Uploading again replaces the previous payload."""
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    raw_name = (file.filename or "").strip()
    if not raw_name:
        raise HTTPException(400, "The payload needs a file name")
    if "/" in raw_name or "\\" in raw_name:
        raise HTTPException(400, "The payload must be a single file with no folder in its name")
    rp = validate_relpath(raw_name)
    clash = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role != "executable").all()
    if any(f.relative_path.lower() == rp.lower() for f in clash):
        raise HTTPException(400, f"The package already contains '{rp}'. Rename the payload or remove that file first.")
    data = await file.read()
    err = validate_upload(rp, "executable", len(data))
    if err:
        raise HTTPException(400, err)
    if data[:2] != b"MZ":
        raise HTTPException(400, "The payload is not a Windows executable (missing MZ header)")
    storage_name, size, sha = save_encrypted_file(data)
    old = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role == "executable").all()
    for o in old:
        if o.storage_name:
            delete_file(o.storage_name)
        db.delete(o)
    db.flush()
    rf = ReleaseFile(release_id=release_id, relative_path=rp, size=size, sha256=sha, role="executable", required=True, storage_name=storage_name)
    db.add(rf)
    db.add(AuditLog(actor=admin.username, action="upload_payload", target=f"{release_id}:{rp}", detail=f"size={size} replaced={len(old)}"))
    db.commit()
    db.refresh(rf)
    return {"id": rf.id, "relative_path": rf.relative_path, "size": rf.size, "sha256": rf.sha256, "role": rf.role, "replaced": len(old)}

@router.delete("/release/{release_id}/files/{file_id}")
def delete_file_entry(release_id: str, file_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rf = db.query(ReleaseFile).filter(ReleaseFile.id == file_id, ReleaseFile.release_id == release_id).first()
    if not rf:
        raise HTTPException(404, "File not found")
    rel = db.query(Release).filter(Release.id == release_id).first()
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    delete_file(rf.storage_name)
    db.delete(rf)
    db.add(AuditLog(actor=admin.username, action="delete_file", target=f"{release_id}:{rf.relative_path}", detail="removed"))
    db.commit()
    return {"ok": True}

@router.post("/release/{release_id}/unpublish")
def unpublish_release(release_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if not rel.published:
        raise HTTPException(400, "Not published")
    rel.published = False
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    db.add(AuditLog(actor=admin.username, action="unpublish_release", target=f"{sw.slug if sw else rel.software_id}:{rel.version}", detail="unpublished"))
    db.commit()
    return {"ok": True}

@router.delete("/release/{release_id}")
def delete_release(release_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    files = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id).all()
    for f in files:
        delete_file(f.storage_name)
        db.delete(f)
    db.delete(rel)
    db.add(AuditLog(actor=admin.username, action="delete_release", target=f"{sw.slug if sw else rel.software_id}:{rel.version}", detail="deleted"))
    db.commit()
    return {"ok": True}

@router.post("/release/{release_id}/publish")
def publish_release(release_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Already published")
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    files = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id).all()
    if not files:
        raise HTTPException(400, "No files")
    # Build + upload zip of non-executable files — unless a whole zip was uploaded
    # (zip-derived manifest): then ship the stored zip as-is.
    payload_files = [f for f in files if f.role == "executable"]
    if sw.separate_executable and not payload_files:
        raise HTTPException(400, "Upload the payload (the executable the launcher loads) before publishing")
    blob_files = [f for f in files if f.storage_name and f.role != "executable"]
    zip_mode = any((not f.storage_name) and f.role != "executable" for f in files)
    cache_dir = STORAGE_DIR / "zips"
    disk_zip = cache_dir / f"{sw.slug}-{rel.version}.zip"
    if zip_mode:
        if not (rel.zip_sha256 and disk_zip.is_file()):
            raise HTTPException(400, "The package zip is missing on the server. Upload it again.")
        zip_sha, zip_size = rel.zip_sha256, rel.zip_size
        r2_key = None
        if r2_enabled():
            r2_key = f"{sw.slug}/{rel.version}/payload.zip"
            upload_zip(str(disk_zip), r2_key)
    else:
        tmp, zip_sha, zip_size = build_zip(blob_files)  # payload-only releases ship an empty package
        r2_key = None
        if r2_enabled():
            r2_key = f"{sw.slug}/{rel.version}/payload.zip"
            upload_zip(tmp, r2_key)
        else:
            # Cache zip on disk for fallback streaming
            import os, shutil
            cache_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tmp, cache_dir / f"{sw.slug}-{rel.version}.zip")
        try:
            os.remove(tmp)
        except OSError:
            pass
    manifest = {
        "app_id": sw.slug,
        "display_name": sw.display_name,
        "release_version": rel.version,
        "manifest_version": rel.manifest_version,
        "published_at": None,
        "zip_sha256": zip_sha,
        "zip_size": zip_size,
        "files": [
            {"relative_path": f.relative_path, "size": f.size, "sha256": f.sha256, "role": f.role, "required": f.required} for f in files
        ],
        "total_size": sum(f.size for f in files),
    }
    from datetime import datetime
    manifest["published_at"] = datetime.utcnow().isoformat() + "Z"
    import json as _j
    mb = _j.dumps(manifest, sort_keys=True).encode()
    sig = sign_manifest(mb)
    rel.manifest_json = mb.decode()
    rel.manifest_signature = sig
    rel.total_size = manifest["total_size"]
    rel.r2_key = r2_key
    rel.zip_sha256 = zip_sha
    rel.zip_size = zip_size
    rel.published = True
    rel.published_at = datetime.utcnow()
    db.add(AuditLog(actor=admin.username, action="publish_release", target=f"{sw.slug}@{rel.version}", detail=f"files={len(files)}"))
    db.commit()
    return {"ok": True, "version": rel.version, "signature": sig}

@router.post("/release/{release_id}/r2-upload-url")
def r2_upload_url(release_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    key = f"{sw.slug}/{rel.version}/payload.zip"
    if not r2_enabled():
        raise HTTPException(503, "R2 not configured")
    url = presigned_put_url(key)
    if not url:
        raise HTTPException(503, "Failed to generate upload URL")
    return {"url": url, "key": key, "expires_in": settings.r2_presigned_ttl}

@router.post("/release/{release_id}/register-zip")
def register_zip(release_id: str, payload: dict, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    r2_key = payload.get("r2_key")
    sha256 = payload.get("sha256")
    size = payload.get("size")
    if not r2_key or not sha256 or not size:
        raise HTTPException(400, "Missing r2_key/sha256/size")
    rel.r2_key = r2_key
    rel.zip_sha256 = sha256
    rel.zip_size = int(size)
    # Build manifest from existing files (if any) or minimal
    files = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id).all()
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    manifest = {
        "app_id": sw.slug, "display_name": sw.display_name,
        "release_version": rel.version, "manifest_version": rel.manifest_version,
        "published_at": None, "zip_sha256": sha256, "zip_size": int(size),
        "files": [{"relative_path": f.relative_path, "size": f.size, "sha256": f.sha256, "role": f.role, "required": f.required} for f in files],
        "total_size": sum(f.size for f in files) or int(size),
    }
    from datetime import datetime as _dt
    manifest["published_at"] = _dt.utcnow().isoformat() + "Z"
    import json as _j
    mb = _j.dumps(manifest, sort_keys=True).encode()
    from ..services.crypto import sign_manifest
    sig = sign_manifest(mb)
    rel.manifest_json = mb.decode()
    rel.manifest_signature = sig
    rel.total_size = manifest["total_size"]
    rel.published = True
    rel.published_at = _dt.utcnow()
    db.add(AuditLog(actor=admin.username, action="register_zip", target=f"{sw.slug}@{rel.version}", detail=f"r2_key={r2_key} sha={sha256}"))
    db.commit()
    return {"ok": True, "version": rel.version, "r2_key": r2_key, "sha256": sha256}
@router.post("/release/{release_id}/zip")
async def upload_zip_package(release_id: str, file: UploadFile = File(...), replace: bool = Form(False), db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """Whole-package zip upload: parses entries, derives the manifest metadata from
    the zip contents, and stores the zip as the shipped payload (disk-only mode)."""
    import io as _io, zipfile as _zf, shutil as _sh, hashlib as _hl
    from datetime import datetime as _dt

    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    if rel.published:
        raise HTTPException(400, "Cannot modify published release")
    sw = db.query(Software).filter(Software.id == rel.software_id).first()

    # The payload (role "executable") is managed separately and is never touched by a package zip.
    existing = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role != "executable").all()
    payload_row = db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role == "executable").first()
    payload_path = payload_row.relative_path.lower() if payload_row else None
    if existing and not replace:
        raise HTTPException(409, "Release already has files uploaded; retry with replace=true to overwrite them")

    cache_dir = STORAGE_DIR / "zips"
    cache_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = STORAGE_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    fd, tmp = tempfile.mkstemp(suffix=".zip", prefix="upload-", dir=str(temp_dir))
    os.close(fd)
    clean = tmp + ".clean"
    try:
        # stream the upload to disk (never hold the whole zip in memory)
        total, head = 0, b""
        with open(tmp, "wb") as fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                if not head:
                    head = chunk[:4]
                total += len(chunk)
                if total > 3 * 1024 * 1024 * 1024:
                    raise HTTPException(413, "Zip too large (max 3 GB)")
                fh.write(chunk)
        if total < 4 or head != b"PK":
            raise HTTPException(400, "File is not a zip archive")
        try:
            zf = _zf.ZipFile(tmp)
        except Exception:
            raise HTTPException(400, "Zip archive is corrupt")
        if zf.testzip() is not None:
            raise HTTPException(400, "Zip archive is corrupt (CRC mismatch)")

        # Apply the same exclusion rules as single-file uploads, and rebuild the stored zip
        # without excluded entries so they are never shipped to customers.
        entries, skipped, seen = [], [], set()
        with _zf.ZipFile(clean, "w", _zf.ZIP_DEFLATED) as out:
            for zi in zf.infolist():
                if zi.is_dir():
                    continue
                rp = validate_relpath(zi.filename)
                role = "normal"  # every file in the package is an ordinary file; the payload is uploaded separately
                reason = validate_upload(rp, role, max(zi.file_size, 1))  # empty files are allowed in a package
                if not reason and rp.lower() == payload_path:
                    reason = "Same name as this release's payload"
                if not reason and rp.lower() in seen:
                    reason = "Duplicate path in zip"
                if reason:
                    skipped.append({"path": rp, "reason": reason})
                    continue
                seen.add(rp.lower())
                sha = _hl.sha256()
                info = _zf.ZipInfo(rp, zi.date_time)
                info.compress_type = _zf.ZIP_DEFLATED
                with zf.open(zi) as src, out.open(info, "w", force_zip64=True) as dst:
                    while True:
                        blk = src.read(1024 * 1024)
                        if not blk:
                            break
                        sha.update(blk)
                        dst.write(blk)
                entries.append((rp, zi.file_size, sha.hexdigest(), role))
        zf.close()
        if not entries:
            raise HTTPException(400, "Zip has no uploadable files" + (f" ({len(skipped)} excluded, e.g. {skipped[0]['path']}: {skipped[0]['reason']})" if skipped else ""))

        # parse OK -> commit replacement
        if existing and replace:
            for rf in existing:
                if rf.storage_name:
                    delete_file(rf.storage_name)
            db.query(ReleaseFile).filter(ReleaseFile.release_id == release_id, ReleaseFile.role != "executable").delete()
            db.flush()

        for rp, size, sha, role in entries:
            db.add(ReleaseFile(release_id=release_id, relative_path=rp, size=size, sha256=sha, role=role, required=True, storage_name="", encrypted=False))
        db.flush()

        dest = cache_dir / f"{sw.slug}-{rel.version}.zip"
        _sh.move(clean, dest)
        os.chmod(dest, 0o644)

        zsha, zsize = _hl.sha256(dest.read_bytes()).hexdigest(), os.path.getsize(dest)
        rel.zip_sha256 = zsha
        rel.zip_size = zsize
        rel.total_size = sum(e[1] for e in entries)
        db.add(AuditLog(actor=admin.username, action="upload_zip", target=f"{sw.slug}@{rel.version}", detail=f"files={len(entries)} excluded={len(skipped)} size={zsize}"))
        db.commit()
    finally:
        for leftover in (tmp, clean):
            if os.path.exists(leftover):
                try:
                    os.remove(leftover)
                except OSError:
                    pass
    db.refresh(rel)
    return {"ok": True, "version": rel.version, "files": len(entries), "skipped": skipped,
            "zip_sha256": rel.zip_sha256, "zip_size": rel.zip_size}

@router.post("/release/{release_id}/republish")
def republish_release(release_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    from datetime import datetime
    rel = db.query(Release).filter(Release.id == release_id).first()
    if not rel or not rel.published:
        raise HTTPException(404, 'Published release not found')
    rel.published_at = datetime.utcnow()
    sw = db.query(Software).filter(Software.id == rel.software_id).first()
    db.add(AuditLog(actor=admin.username, action='rollback_release', target=f'{sw.slug}@{rel.version}', detail='marked latest'))
    db.commit()
    return {'ok': True, 'version': rel.version}

