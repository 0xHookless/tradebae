import hashlib, secrets
from datetime import datetime, timedelta
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
import jwt
from ..config import settings

ph = PasswordHasher()

def hash_password(pw: str) -> str:
    return ph.hash(pw)

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return ph.verify(hashed, pw)
    except VerifyMismatchError:
        return False
    except Exception:
        return False

def create_access_token(subject: str, extra: dict = None) -> str:
    now = datetime.utcnow()
    payload = {"sub": subject, "iat": now, "exp": now + timedelta(minutes=settings.access_token_expire_minutes), "type": "access"}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

def create_refresh_token(subject: str) -> str:
    now = datetime.utcnow()
    payload = {"sub": subject, "iat": now, "exp": now + timedelta(days=settings.refresh_token_expire_days), "type": "refresh", "jti": secrets.token_hex(16)}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)

def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])

def hwid_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
