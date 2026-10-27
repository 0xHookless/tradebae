import secrets, json, base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..database import get_db
from ..models import Software, Release, ReleaseFile, License, AuditLog
from ..schemas import LicenseCreate, LicenseOut, LicenseExtend, LicenseProducts
from ..services.storage import read_decrypted_file
from ..services.auth import create_access_token
from ..services.crypto import sign_bytes, verify_bytes, get_public_key_xy
from .auth import get_current_admin
import jwt
from ..config import settings

router = APIRouter(tags=["licenses"])

def license_products(lic: License) -> list[str]:
    """Parse the license scope into a list of products.

    Convention: "*" = all products, otherwise a comma-separated slug list
    (a single slug is the legacy one-product form)."""
    raw = (lic.software_slug or "").strip()
    if not raw or raw == "*":
        return ["*"]
    if "," in raw:
        return [s.strip() for s in raw.split(",") if s.strip()]
    return [raw]

def validate_license(db, key, hwid, software_slug, *, bind=True):
    # Case-insensitive so keys pasted with wrong case still work
    lic = db.query(License).filter(func.upper(License.key) == (key or "").strip().upper()).first()
    if not lic:
        raise HTTPException(401, "Invalid license key")
    if lic.revoked:
        raise HTTPException(403, "License revoked")
    if lic.expires_at and lic.expires_at < datetime.utcnow():
        raise HTTPException(403, "License expired")
    prods = license_products(lic)
    # "*" as the requested product means "activate this key" (the launcher's first activation):
    # any key that carries at least one product is accepted, and its scope is returned as-is.
    if software_slug != "*" and "*" not in prods and software_slug not in prods:
        raise HTTPException(403, "License not valid for this software")
    if not bind:
        return lic
    if lic.hwid and lic.hwid != hwid:
        raise HTTPException(403, "License bound to another device")
    if not lic.hwid:
        lic.hwid = hwid
        db.commit()
    return lic

def mask_hwid(hwid: str | None) -> str | None:
    if not hwid:
        return None
    if len(hwid) <= 12:
        return hwid[:4] + "…"
    return hwid[:8] + "…" + hwid[-4:]

@router.post("/licenses", response_model=LicenseOut)
def create_license(data: LicenseCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    # Optional custom key (import keys issued elsewhere); auto-generate when absent.
    key = (data.key or "").strip()
    if key:
        if db.query(License).filter(func.upper(License.key) == key.upper()).first():
            raise HTTPException(400, "License key already exists")
    else:
        key = "LIC-" + secrets.token_hex(16).upper()
    expires = datetime.utcnow() + timedelta(days=data.days) if data.days and data.days > 0 else None
    lic = License(key=key, days=data.days, software_slug=data.software_slug, expires_at=expires, note=data.note)
    db.add(lic)
    db.add(AuditLog(actor=admin.username, action="create_license", target=key,
                    detail=f"days={data.days} scope={data.software_slug}{'' if not data.key else ' custom'}"))
    db.commit()
    db.refresh(lic)
    return lic

@router.get("/licenses", response_model=list[LicenseOut])
def list_licenses(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    items = db.query(License).order_by(License.created_at.desc()).all()
    out = []
    for lic in items:
        d = LicenseOut.from_orm(lic).dict()
        d["hwid_masked"] = mask_hwid(lic.hwid)
        d.pop("hwid", None)  # full binding never leaves the server
        out.append(d)
    return out

@router.post("/licenses/{key}/revoke")
def revoke_license(key: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    lic = db.query(License).filter(License.key == key).first()
    if not lic:
        raise HTTPException(404, "Not found")
    lic.revoked = True
    db.add(AuditLog(actor=admin.username, action="revoke_license", target=key, detail="revoked"))
    db.commit()
    return {"ok": True}

@router.post("/licenses/{key}/extend")
def extend_license(key: str, data: LicenseExtend, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    lic = db.query(License).filter(License.key == key).first()
    if not lic:
        raise HTTPException(404, "Not found")
    base = lic.expires_at if (lic.expires_at and lic.expires_at > datetime.utcnow()) else datetime.utcnow()
    lic.expires_at = base + timedelta(days=data.days)
    lic.days = (lic.days or 0) + data.days
    db.add(AuditLog(actor=admin.username, action="extend_license", target=key, detail=f"+{data.days} days"))
    db.commit()
    return {"ok": True, "expires_at": lic.expires_at}

@router.post("/licenses/{key}/unbind")
def unbind_license(key: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    lic = db.query(License).filter(License.key == key).first()
    if not lic:
        raise HTTPException(404, "Not found")
    previous = mask_hwid(lic.hwid)
    lic.hwid = None
    db.add(AuditLog(actor=admin.username, action="unbind_license", target=key, detail=f"cleared binding {previous or 'none'}"))
    db.commit()
    return {"ok": True}

@router.get("/licenses/public-key")
def license_public_key():
    return get_public_key_xy()

@router.put("/licenses/{key}/products")
def set_license_products(key: str, data: LicenseProducts, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """Add/remove products for a license in one call: PUT the full product list.

    products = "*" (all products) or a list of software slugs."""
    lic = db.query(License).filter(License.key == key).first()
    if not lic:
        raise HTTPException(404, "Not found")
    p = data.products
    if isinstance(p, str):
        p = [s.strip() for s in ([p] if p == "*" else p.split(",")) if s.strip()]
    p = [s for s in dict.fromkeys(p) if s]
    if not p:
        raise HTTPException(422, "Empty product list")
    for slug in p:
        if slug != "*" and not db.query(Software).filter(Software.slug == slug).first():
            raise HTTPException(404, f"Unknown software: {slug}")
    before = lic.software_slug
    lic.software_slug = "*" if "*" in p else ",".join(sorted(p))
    db.add(AuditLog(actor=admin.username, action="set_license_products", target=key,
                    detail=f"scope {before} -> {lic.software_slug}"))
    db.commit()
    db.refresh(lic)
    return {"ok": True, "scope": lic.software_slug, "products": license_products(lic)}

@router.post("/licenses/status")
def license_status(payload: dict, db: Session = Depends(get_db)):
    key = payload.get("key")
    hwid = payload.get("hwid")
    software_slug = payload.get("software_slug", "*")
    if not key or not hwid:
        raise HTTPException(400, "Missing key/hwid")
    lic = db.query(License).filter(func.upper(License.key) == key.strip().upper()).first()
    if not lic:
        raise HTTPException(404, "Unknown license key")
    now = datetime.utcnow()
    expired = bool(lic.expires_at and lic.expires_at < now)
    bound_hwid = lic.hwid
    hwid_matches = bool(bound_hwid and bound_hwid == hwid)
    prods = license_products(lic)
    scope_ok = "*" in prods or software_slug in prods
    days_remaining = None
    if lic.expires_at and not expired:
        days_remaining = max(0, (lic.expires_at - now).days)
    return {
        "revoked": bool(lic.revoked),
        "expired": expired,
        "bound": bool(bound_hwid),
        "hwid_matches": hwid_matches,
        "bound_hwid_masked": mask_hwid(bound_hwid),
        "scope": lic.software_slug,
        "scope_ok": scope_ok,
        "expires_at": lic.expires_at,
        "days_remaining": days_remaining,
    }

@router.post("/licenses/activate")
def activate_license(payload: dict, db: Session = Depends(get_db)):
    key = payload.get("key")
    hwid = payload.get("hwid")
    software_slug = payload.get("software_slug", "*")
    if not key or not hwid:
        raise HTTPException(400, "Missing key/hwid")
    lic = validate_license(db, key, hwid, software_slug)
    exp = lic.expires_at if lic.expires_at else datetime.utcnow() + timedelta(days=3650)
    body = {
        "key": lic.key, "hwid": hwid, "scope": lic.software_slug,
        "exp": int(exp.timestamp()),
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = sign_bytes(payload_b64.encode())
    token = payload_b64 + "." + sig
    return {"license_token": token, "expires_at": lic.expires_at}

def decode_license_token(token: str) -> dict:
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError:
        raise HTTPException(401, "Invalid license token")
    if not verify_bytes(payload_b64.encode(), sig):
        raise HTTPException(401, "Invalid license signature")
    pad = "=" * (-len(payload_b64) % 4)
    try:
        body = json.loads(base64.urlsafe_b64decode(payload_b64 + pad))
    except Exception:
        raise HTTPException(401, "Invalid license payload")
    if int(body.get("exp", 0)) < int(datetime.utcnow().timestamp()):
        raise HTTPException(403, "License token expired")
    return body

@router.post("/licenses/check")
def check_license(payload: dict):
    token = payload.get("token")
    if not token:
        raise HTTPException(400, "Missing token")
    data = decode_license_token(token)
    return {"valid": True, "expires_at": data.get("exp"), "hwid": data.get("hwid"), "scope": data.get("scope")}
