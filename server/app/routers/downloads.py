import json
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Software, Release, ReleaseFile
from ..services.storage import read_decrypted_file
from .licenses import validate_license, decode_license_token
from ..services.r2 import r2_enabled, presigned_url
from ..config import settings
import os, hashlib

router = APIRouter(tags=["download"])

def _get_release(db, slug, version):
    sw = db.query(Software).filter(Software.slug == slug).first()
    if not sw:
        raise HTTPException(404, "Software not found")
    if version in ("latest", "", None):
        rel = db.query(Release).filter(Release.software_id == sw.id, Release.published == True).order_by(Release.published_at.desc()).first()
    else:
        rel = db.query(Release).filter(Release.software_id == sw.id, Release.version == version, Release.published == True).first()
    if not rel:
        raise HTTPException(404, "Release not found")
    return sw, rel

@router.get("/catalog")
def catalog(db: Session = Depends(get_db)):
    sws = db.query(Software).all()
    out = []
    for sw in sws:
        rel = db.query(Release).filter(Release.software_id == sw.id, Release.published == True).order_by(Release.published_at.desc()).first()
        out.append({"slug": sw.slug, "display_name": sw.display_name, "description": sw.description, "icon_url": sw.icon_url, "install_dir_name": sw.install_dir_name, "executable_name": sw.executable_name, "launch_args": sw.launch_args, "separate_executable": sw.separate_executable, "launch_mode": sw.launch_mode or "", "local_stack": bool(sw.local_stack), "latest_version": rel.version if rel else None, "total_size": rel.total_size if rel else 0})
    return out

@router.get("/catalog/{slug}/manifest")
def get_manifest(slug: str, version: str = Query("latest"), db: Session = Depends(get_db)):
    sw, rel = _get_release(db, slug, version)
    return {"app_id": sw.slug, "display_name": sw.display_name, "release_version": rel.version,
            "manifest_version": rel.manifest_version, "total_size": rel.total_size,
            "manifest_raw": rel.manifest_json, "signature": rel.manifest_signature,
            "signing_key": "/licenses/public-key"}

@router.post("/download/{slug}/{version}/zip-url")
def zip_url(slug: str, version: str, payload: dict, db: Session = Depends(get_db)):
    sw, rel = _get_release(db, slug, version)
    key = payload.get("key"); hwid = payload.get("hwid"); token = payload.get("license_token")
    if token:
        body = decode_license_token(token)
        raw = (body.get("scope") or "").strip()
        token_scope = ["*"] if raw == "*" else [s.strip() for s in raw.split(",") if s.strip()]
        if "*" not in token_scope and slug not in token_scope:
            raise HTTPException(403, "License not valid for this software")
        if not hwid or body.get("hwid") != hwid:
            raise HTTPException(403, "HWID mismatch")
    else:
        if not key or not hwid:
            raise HTTPException(401, "License required")
        validate_license(db, key, hwid, slug)
    if not rel.zip_sha256:
        raise HTTPException(404, "No zip for this release")
    if r2_enabled() and rel.r2_key:
        url = presigned_url(rel.r2_key)
        return {"url": url, "sha256": rel.zip_sha256, "size": rel.zip_size, "expires_in": settings.r2_presigned_ttl}
    # Fallback: stream from disk
    cache_path = os.path.join(settings.storage_dir, "zips", f"{slug}-{rel.version}.zip")
    # build on demand if missing
    if not os.path.exists(cache_path):
        from ..services.r2 import build_zip
        files = db.query(ReleaseFile).filter(ReleaseFile.release_id == rel.id).all()
        tmp, sha, sz = build_zip(files)
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        os.replace(tmp, cache_path)
    return {"url": f"{settings and ''}/download/{slug}/{version}/zip-stream", "sha256": rel.zip_sha256, "size": rel.zip_size, "expires_in": 300}

@router.get("/download/{slug}/{version}/zip-stream")
def zip_stream(slug: str, version: str, db: Session = Depends(get_db)):
    sw, rel = _get_release(db, slug, version)
    cache_path = os.path.join(settings.storage_dir, "zips", f"{slug}-{rel.version}.zip")
    if not os.path.exists(cache_path):
        raise HTTPException(404, "Zip not available")
    from fastapi.responses import FileResponse
    return FileResponse(cache_path, media_type="application/zip", filename=f"{slug}-{version}.zip")

@router.get("/download/{slug}/{version}/{relative_path:path}")
def download_file(slug: str, version: str, relative_path: str, license_key: str = Query(None), hwid: str = Query(None), license_token: str = Query(None), db: Session = Depends(get_db)):
    sw, rel = _get_release(db, slug, version)

    # license check
    if license_token:
        # License tokens (payload_b64.sig, signed by the ECDSA key) are
        # cumulative-signed and self-contained: verify signature, expiry,
        # scope and HWID binding. hwid must be provided for token auth.
        try:
            body = decode_license_token(license_token)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(401, "Invalid license token")
        raw = (body.get("scope") or "").strip()
        token_scope = ["*"] if raw == "*" else [s.strip() for s in raw.split(",") if s.strip()]
        if "*" not in token_scope and slug not in token_scope:
            raise HTTPException(403, "License not valid for this software")
        if not hwid or body.get("hwid") != hwid:
            raise HTTPException(403, "HWID mismatch")
    else:
        if not license_key or not hwid:
            raise HTTPException(401, "License required")
        validate_license(db, license_key, hwid, slug)
    rf = db.query(ReleaseFile).filter(ReleaseFile.release_id == rel.id, ReleaseFile.relative_path == relative_path).first()
    if not rf:
        raise HTTPException(404, "File not found")
    if rf.storage_name:
        # Uploaded individually (the payload, or a file added outside a package zip): its own encrypted blob.
        data = read_decrypted_file(rf.storage_name)
    else:
        # Came from a package zip: no individual blob, only the cached zip. Extract this one entry from it.
        import zipfile
        cache_path = os.path.join(settings.storage_dir, "zips", f"{slug}-{rel.version}.zip")
        if not os.path.exists(cache_path):
            raise HTTPException(404, "Package is not available for individual download; fetch the full zip instead")
        try:
            with zipfile.ZipFile(cache_path) as zf:
                data = zf.read(rf.relative_path)
        except KeyError:
            raise HTTPException(404, "File not found in package")
    return Response(content=data, media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{rf.relative_path.split("/")[-1]}"'})
