import uuid
from datetime import datetime, timedelta
from sqlalchemy import Column, String, Integer, DateTime, Boolean, Text, ForeignKey, Float, LargeBinary
from sqlalchemy.orm import relationship
from .database import Base

def uid():
    return str(uuid.uuid4())

class AdminUser(Base):
    __tablename__ = "admin_users"
    id = Column(String, primary_key=True, default=uid)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)

class Software(Base):
    __tablename__ = "software"
    id = Column(String, primary_key=True, default=uid)
    slug = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    description = Column(Text, default="")
    icon_url = Column(String, default="")
    install_dir_name = Column(String, default="")
    executable_name = Column(String, default="")
    launch_args = Column(Text, default="")
    separate_executable = Column(Boolean, default=False)
    launch_mode = Column(String, default="")
    local_stack = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    releases = relationship("Release", back_populates="software", cascade="all, delete-orphan")

class Release(Base):
    __tablename__ = "releases"
    id = Column(String, primary_key=True, default=uid)
    software_id = Column(String, ForeignKey("software.id"), nullable=False)
    version = Column(String, nullable=False)
    manifest_version = Column(Integer, default=1)
    published = Column(Boolean, default=False)
    published_at = Column(DateTime, nullable=True)
    total_size = Column(Integer, default=0)
    manifest_json = Column(Text, default="{}")
    manifest_signature = Column(String, default="")
    r2_key = Column(String, nullable=True)
    zip_sha256 = Column(String, nullable=True)
    zip_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    software = relationship("Software", back_populates="releases")
    files = relationship("ReleaseFile", back_populates="release", cascade="all, delete-orphan")

class ReleaseFile(Base):
    __tablename__ = "release_files"
    id = Column(String, primary_key=True, default=uid)
    release_id = Column(String, ForeignKey("releases.id"), nullable=False)
    relative_path = Column(String, nullable=False)
    size = Column(Integer, default=0)
    sha256 = Column(String, nullable=False)
    role = Column(String, default="normal")  # normal | executable
    required = Column(Boolean, default=True)
    storage_name = Column(String, nullable=False)
    encrypted = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    release = relationship("Release", back_populates="files")

class License(Base):
    __tablename__ = "licenses"
    id = Column(String, primary_key=True, default=uid)
    key = Column(String, unique=True, nullable=False, index=True)
    software_slug = Column(String, default="*")  # * = all
    days = Column(Integer, default=30)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    hwid = Column(String, nullable=True)
    revoked = Column(Boolean, default=False)
    note = Column(String, default="")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=uid)
    actor = Column(String, default="system")
    action = Column(String, nullable=False)
    target = Column(String, default="")
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class UploadSession(Base):
    __tablename__ = "upload_sessions"
    id = Column(String, primary_key=True, default=uid)
    software_id = Column(String, ForeignKey("software.id"), nullable=False)
    role = Column(String, default="normal")
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

class ClientRelease(Base):
    __tablename__ = "client_releases"
    id = Column(String, primary_key=True, default=uid)
    version = Column(String, nullable=False)
    notes = Column(String, default="")
    storage_name = Column(String, nullable=False)
    sha256 = Column(String, nullable=False)
    size = Column(Integer, default=0)
    published = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
