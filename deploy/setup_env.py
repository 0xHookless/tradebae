"""Creates server/.env with fresh random secrets. Safe to run again: it never overwrites an existing .env."""
import base64
import getpass
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "server"
ENV = SERVER / ".env"
KEY = SERVER / "app" / "signing_key.pem"

if ENV.exists():
    print("server\\.env already exists - leaving it as it is.")
    sys.exit(0)

print()
print("Choose the admin password for the admin panel.")
print("At least 12 characters. Press Enter to have one generated for you.")
while True:
    pw = getpass.getpass("Admin password: ")
    if not pw:
        pw = secrets.token_urlsafe(16)
        print()
        print("Generated admin password (write it down, it is not shown again):")
        print("    " + pw)
        break
    if len(pw) < 12:
        print("Too short. Use at least 12 characters.")
        continue
    if getpass.getpass("Repeat password: ") != pw:
        print("Passwords did not match. Try again.")
        continue
    break

lines = [
    "SECRET_KEY=" + secrets.token_urlsafe(64),
    "MASTER_ENCRYPTION_KEY=" + base64.b64encode(secrets.token_bytes(32)).decode(),
    "LICENSE_SECRET=" + secrets.token_urlsafe(32),
    "ADMIN_BOOTSTRAP_USERNAME=admin",
    "ADMIN_BOOTSTRAP_PASSWORD=" + pw,
    "DATABASE_URL=sqlite:///./data.db",
    "STORAGE_DIR=./storage",
    "CORS_ORIGINS=*",
    "",
]
ENV.write_text("\n".join(lines), encoding="utf-8")
print()
print("Created server\\.env")
print("Back this file up. MASTER_ENCRYPTION_KEY must never change once files are uploaded,")
print("or every uploaded file becomes unreadable.")

if KEY.exists():
    print()
    print("Signing key found: the launcher's pinned key will match this server.")
else:
    print()
    print("WARNING: server\\app\\signing_key.pem is missing. The server will create a NEW key,")
    print("and the launcher (which pins the old public key) will reject this server's manifests.")
