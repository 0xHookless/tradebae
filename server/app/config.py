from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path

class Settings(BaseSettings):
    app_name: str = "Trading Platform Distribution Server"
    env: str = "development"
    secret_key: str = Field(default="change-me-in-production-please")
    database_url: str = "sqlite:///./data.db"
    storage_dir: str = "./storage"
    admin_bootstrap_username: str = "admin"
    admin_bootstrap_password: str = "ChangeMe123!"
    license_secret: str = "change-me-license-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    master_encryption_key: str = ""
    cors_origins: str = "*"
    rate_limit_login: str = "5/minute"

    # Cloudflare R2 (S3-compatible). Empty = R2 disabled; server streams zips from disk.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_presigned_ttl: int = 300

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = (BASE_DIR / settings.storage_dir).resolve()
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
(STORAGE_DIR / "binaries").mkdir(parents=True, exist_ok=True)
(STORAGE_DIR / "temp").mkdir(parents=True, exist_ok=True)
