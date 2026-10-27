"""Builds TradeBayServer.zip: server + prebuilt admin panel + setup scripts, ready for the VPS.

Allow-list only. Dev data (data.db, logs, storage, tokens, .env, caches) is never included.
The server's private signing key IS included on purpose: the launcher pins its public half.
"""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "TradeBayServer.zip"
TOP = "TradeBayServer"

if not (ROOT / "admin" / "dist" / "index.html").exists():
    sys.exit("admin/dist is missing. Run: cd admin && npx vite build")
if not (ROOT / "server" / "app" / "signing_key.pem").exists():
    sys.exit("server/app/signing_key.pem is missing.")

files = []  # (source path, path inside the zip)


def add(src: Path, dest: str):
    files.append((src, f"{TOP}/{dest}"))


for name in ("setup.bat", "start.bat", "start-tunnel.bat", "backup.bat", "setup_env.py", "README-VPS.md"):
    add(ROOT / "deploy" / name, name)

add(ROOT / "server" / "requirements.txt", "server/requirements.txt")
add(ROOT / "server" / ".env.example", "server/.env.example")
for p in sorted((ROOT / "server" / "app").rglob("*")):
    if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc":
        add(p, "server/app/" + p.relative_to(ROOT / "server" / "app").as_posix())

for p in sorted((ROOT / "admin" / "dist").rglob("*")):
    if p.is_file():
        add(p, "admin/dist/" + p.relative_to(ROOT / "admin" / "dist").as_posix())

for p in sorted((ROOT / "docs").glob("*.md")):
    add(p, "docs/" + p.name)

BANNED = ("data.db", ".env", "tok", "tok.json", ".log")
for _, dest in files:
    leaf = dest.rsplit("/", 1)[-1]
    assert leaf not in BANNED and not leaf.endswith(".log"), f"refusing to package {dest}"

OUT.unlink(missing_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for src, dest in files:
        z.write(src, dest)

print(f"{OUT}  {OUT.stat().st_size / 1024:.0f} KB  {len(files)} files")
