import os, uuid, hashlib, shutil
from pathlib import Path
from ..config import STORAGE_DIR

def storage_path(storage_name: str) -> Path:
    return STORAGE_DIR / "binaries" / storage_name

def save_encrypted_file(data: bytes) -> tuple[str, int, str]:
    from .crypto import encrypt_bytes
    blob = encrypt_bytes(data)
    name = uuid.uuid4().hex + ".bin"
    p = storage_path(name)
    p.write_bytes(blob)
    sha = hashlib.sha256(data).hexdigest()
    return name, len(data), sha

def read_decrypted_file(storage_name: str) -> bytes:
    from .crypto import decrypt_bytes
    blob = storage_path(storage_name).read_bytes()
    return decrypt_bytes(blob)

def delete_file(storage_name: str):
    p = storage_path(storage_name)
    try:
        p.unlink(missing_ok=True)
    except Exception:
        pass

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
