"""Payload-vs-package test against a running server.

Verifies: payload upload is separate from the package zip, publish requires a payload
for separate_executable apps, the payload never ends up inside the shipped zip, and
licensed downloads can fetch the payload by its own relative path.
"""
import io
import sys
import time
import zipfile

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "ChangeMe123!"

c = httpx.Client(base_url=BASE, timeout=60)
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)


r = c.post("/auth/login", json={"username": USER, "password": PASSWORD})
check("admin login", r.status_code == 200, r.text[:160])
H = {"Authorization": "Bearer " + r.json()["access_token"]}

slug = "sierra-chart"
ver = f"payloadtest-{int(time.time())}"
r = c.post(f"/releases/{slug}", headers=H, json={"version": ver})
check("create draft", r.status_code == 200, r.text[:160])
rid = r.json()["id"]

# publish with no payload must be refused for a separate_executable app
r = c.post(f"/release/{rid}/publish", headers=H)
check("publish refused with no files at all", r.status_code == 400, str(r.status_code))

# package zip: normal files only
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("config/default.ini", "a=1\n")
    z.writestr("lib/helper.dll", "d" * 500)
    z.writestr("readme.txt", "hello\n")
r = c.post(f"/release/{rid}/zip", headers=H, files={"file": ("pkg.zip", buf.getvalue(), "application/zip")}, data={"replace": "false"})
check("package zip accepted", r.status_code == 200, r.text[:200])

# publish without a payload must still be refused (sierra-chart is separate_executable)
r = c.post(f"/release/{rid}/publish", headers=H)
check("publish refused without payload", r.status_code == 400 and "payload" in r.text.lower(), r.text[:160])

# payload upload
payload_bytes = b"MZ" + b"P" * 5000
r = c.post(f"/release/{rid}/payload", headers=H, files={"file": ("SierraChart_64.exe", payload_bytes)})
check("payload upload accepted", r.status_code == 200, r.text[:200])
pj = r.json()
check("payload role is executable", pj["relative_path"] == "SierraChart_64.exe")

# non-exe payload rejected
r = c.post(f"/release/{rid}/payload", headers=H, files={"file": ("notexe.bin", b"not an exe at all")})
check("non-MZ payload rejected", r.status_code == 400, r.text[:160])

# a payload filename with a folder in it is rejected (it must be a single top-level file)
r = c.post(f"/release/{rid}/payload", headers=H, files={"file": ("config/default.ini", payload_bytes)})
check("payload with a folder in its name rejected", r.status_code == 400, r.text[:160])

# a payload whose bare name matches an existing top-level package file is rejected
r = c.post(f"/release/{rid}/payload", headers=H, files={"file": ("readme.txt", payload_bytes)})
check("payload colliding with a package file's name rejected", r.status_code == 400, r.text[:160])

# confirm the real payload (SierraChart_64.exe) is still the one on file after the rejected attempts
r = c.get(f"/release/{rid}", headers=H)
still_there = any(f["role"] == "executable" and f["relative_path"] == "SierraChart_64.exe" for f in r.json()["files"])
check("original payload untouched by rejected uploads", still_there)

# now publish should succeed
r = c.post(f"/release/{rid}/publish", headers=H)
check("publish succeeds with zip + payload", r.status_code == 200, r.text[:200])

# the release listing shows exactly one executable-role file and the normal ones
r = c.get(f"/release/{rid}", headers=H)
files = r.json()["files"]
roles = sorted((f["role"], f["relative_path"]) for f in files)
check("file list has payload + 3 normal files", roles == [("executable", "SierraChart_64.exe"), ("normal", "config/default.ini"), ("normal", "lib/helper.dll"), ("normal", "readme.txt")], str(roles))

# the shipped package zip must NOT contain the payload
import os
zpath = os.path.join("storage", "zips", f"{slug}-{ver}.zip")
check("shipped zip file exists on disk", os.path.exists(zpath), zpath)
if os.path.exists(zpath):
    names = zipfile.ZipFile(zpath).namelist()
    check("payload absent from shipped package zip", "SierraChart_64.exe" not in names, str(names))
    check("package zip has the normal files", set(names) == {"config/default.ini", "lib/helper.dll", "readme.txt"}, str(names))

# manifest lists the payload with its hash, separate from the zip hash
manifest_resp = c.get(f"/catalog/{slug}/manifest", params={"version": ver})
check("manifest fetch ok", manifest_resp.status_code == 200, manifest_resp.text[:160])

# download the payload with a license
r = c.post("/licenses", headers=H, json={"days": 1, "software_slug": slug})
key = r.json()["key"]
hwid = "HWID-PAYLOAD-TEST"
r = c.post("/licenses/activate", json={"key": key, "hwid": hwid, "software_slug": slug})
check("activate for download test", r.status_code == 200, r.text[:160])
r = c.get(f"/download/{slug}/{ver}/SierraChart_64.exe", params={"license_key": key, "hwid": hwid})
check("payload downloads via licensed route", r.status_code == 200 and r.content == payload_bytes, str(r.status_code))
r = c.get(f"/download/{slug}/{ver}/config/default.ini", params={"license_key": key, "hwid": hwid})
check("normal file still downloads via licensed route", r.status_code == 200 and r.content == b"a=1\n", str(r.status_code))

# cleanup: revoke the throwaway license
c.post(f"/licenses/{key}/revoke", headers=H)

print()
print("PAYLOAD TEST OK" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
