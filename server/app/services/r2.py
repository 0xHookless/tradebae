import io, os, zipfile, hashlib, tempfile
from pathlib import Path
from ..config import settings
from .storage import read_decrypted_file

def r2_enabled():
    return bool(settings.r2_account_id and settings.r2_access_key_id and settings.r2_secret_access_key and settings.r2_bucket_name)

def _client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
    )

def build_zip(release_files):
    """Build a zip from non-executable release files. Returns (path, sha256, size)."""
    fd, tmp = tempfile.mkstemp(suffix=".zip", prefix="release-")
    os.close(fd)
    h = hashlib.sha256()
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for rf in release_files:
            if rf.role == "executable":
                continue
            data = read_decrypted_file(rf.storage_name)
            zf.writestr(rf.relative_path.replace("\\", "/"), data)
    with open(tmp, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    size = os.path.getsize(tmp)
    return tmp, h.hexdigest(), size

def upload_zip(tmp_path, key):
    if not r2_enabled():
        return None
    _client().upload_file(tmp_path, settings.r2_bucket_name, key)
    return key

def presigned_url(key, ttl=None):
    if not r2_enabled():
        return None
    ttl = ttl or settings.r2_presigned_ttl
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key},
        ExpiresIn=ttl,
    )

def presigned_put_url(key, ttl=None, content_type="application/zip"):
    if not r2_enabled():
        return None
    ttl = ttl or settings.r2_presigned_ttl
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key, "ContentType": content_type},
        ExpiresIn=ttl,
        HttpMethod="PUT",
    )
    if not r2_enabled():
        return None
    ttl = ttl or settings.r2_presigned_ttl
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key},
        ExpiresIn=ttl,
    )
