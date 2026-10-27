import base64, os, hashlib, json
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives import hashes, serialization
from ..config import settings
from pathlib import Path

def get_master_key() -> bytes:
    k = settings.master_encryption_key.strip()
    if not k:
        return hashlib.sha256(settings.secret_key.encode()).digest()
    try:
        raw = base64.b64decode(k)
    except Exception:
        raw = k.encode()
    if len(raw) < 32:
        raw = hashlib.sha256(raw).digest()
    return raw[:32]

def encrypt_bytes(plaintext: bytes) -> bytes:
    key = get_master_key()
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext, None)
    return nonce + ct

def decrypt_bytes(blob: bytes) -> bytes:
    key = get_master_key()
    aes = AESGCM(key)
    nonce = blob[:12]
    ct = blob[12:]
    return aes.decrypt(nonce, ct, None)

KEY_PATH = Path(__file__).resolve().parent.parent / "signing_key.pem"

def load_or_create_signing_key():
    if KEY_PATH.exists():
        data = KEY_PATH.read_bytes()
        try:
            key = serialization.load_pem_private_key(data, password=None)
            if isinstance(key, ec.EllipticCurvePrivateKey):
                return key
        except Exception:
            pass
    key = ec.generate_private_key(ec.SECP256R1())
    KEY_PATH.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    return key

_signing_key = load_or_create_signing_key()

def _p1363(sig_der: bytes) -> bytes:
    r, s = decode_dss_signature(sig_der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")

def sign_bytes(data: bytes) -> str:
    der = _signing_key.sign(data, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(_p1363(der)).decode()

def verify_bytes(data: bytes, sig_b64: str) -> bool:
    try:
        raw = base64.b64decode(sig_b64)
        r = int.from_bytes(raw[:32], "big")
        s = int.from_bytes(raw[32:], "big")
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        der = encode_dss_signature(r, s)
        _signing_key.public_key().verify(der, data, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False

def get_public_key_pem() -> str:
    return _signing_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

def get_public_key_xy() -> dict:
    nums = _signing_key.public_key().public_numbers()
    return {"x": base64.b64encode(nums.x.to_bytes(32, "big")).decode(),
            "y": base64.b64encode(nums.y.to_bytes(32, "big")).decode()}

# backwards compatible names
def sign_manifest(manifest_bytes: bytes) -> str:
    return sign_bytes(manifest_bytes)

def verify_manifest(manifest_bytes: bytes, sig_b64: str) -> bool:
    return verify_bytes(manifest_bytes, sig_b64)
