from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional
from datetime import datetime

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class SoftwareCreate(BaseModel):
    slug: str
    display_name: str
    description: str = ""
    icon_url: str = ""
    install_dir_name: str = ""
    executable_name: str = ""
    launch_args: str = ""
    separate_executable: bool = False
    launch_mode: Optional[str] = None
    local_stack: Optional[bool] = None

class SoftwareOut(BaseModel):
    id: str
    slug: str
    display_name: str
    description: str
    icon_url: str
    install_dir_name: str
    executable_name: str
    launch_args: str
    separate_executable: bool
    local_stack: bool = False
    created_at: datetime
    latest_version: Optional[str] = None
    class Config:
        from_attributes = True

class FileEntry(BaseModel):
    relative_path: str
    size: int
    sha256: str
    role: str = "normal"
    required: bool = True

class ReleaseCreate(BaseModel):
    version: str

class ReleaseOut(BaseModel):
    id: str
    software_id: str
    version: str
    manifest_version: int
    published: bool
    published_at: Optional[datetime]
    total_size: int
    created_at: datetime
    class Config:
        from_attributes = True

class LicenseCreate(BaseModel):
    days: int = 30
    software_slug: str = "*"
    note: str = ""
    key: Optional[str] = None

class LicenseOut(BaseModel):
    id: str
    key: str
    software_slug: str
    days: int | None
    created_at: datetime
    expires_at: datetime | None
    hwid: str | None = None
    hwid_masked: str | None = None
    revoked: bool
    note: str
    class Config:
        from_attributes = True

class LicenseExtend(BaseModel):
    days: int

class LicenseProducts(BaseModel):
    products: str | list[str] = "*"

class AuditOut(BaseModel):
    id: str
    actor: str
    action: str
    target: str
    detail: str
    created_at: datetime
    class Config:
        from_attributes = True

class HealthOut(BaseModel):
    status: str
    version: str = "1.0.0"
