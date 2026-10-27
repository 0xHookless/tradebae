"""License lifecycle check against a running server.

Usage: python tests/license_lifecycle_test.py [base_url] [admin_user] [admin_password]
Creates its own throwaway licenses and revokes them at the end.
"""
import sys
import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "ChangeMe123!"

c = httpx.Client(base_url=BASE, timeout=30)
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)


r = c.post("/auth/login", json={"username": USER, "password": PASSWORD})
check("admin login", r.status_code == 200, r.text[:120])
H = {"Authorization": "Bearer " + r.json()["access_token"]}

slugs = [s["slug"] for s in c.get("/software", headers=H).json()]
check("catalog has software", len(slugs) >= 2, str(slugs))
one, two = slugs[0], slugs[1]

# create: 7 days, single product
r = c.post("/licenses", headers=H, json={"days": 7, "software_slug": one, "note": "lifecycle test"})
check("create license", r.status_code == 200, r.text[:120])
lic = r.json()
key = lic["key"]
check("expiry set from days", lic["expires_at"] is not None)

# activation: first device binds, second is refused
r = c.post("/licenses/activate", json={"key": key, "hwid": "HWID-A", "software_slug": one})
check("activate on device A", r.status_code == 200, r.text[:120])
token = r.json().get("license_token", "")
r = c.post("/licenses/check", json={"token": token})
check("signed token verifies offline", r.status_code == 200 and r.json()["valid"], r.text[:120])
r = c.post("/licenses/activate", json={"key": key, "hwid": "HWID-B", "software_slug": one})
check("device B refused", r.status_code == 403, str(r.status_code))
r = c.post("/licenses/activate", json={"key": key, "hwid": "HWID-A", "software_slug": two})
check("other product refused", r.status_code == 403, str(r.status_code))

# extend
before = c.get("/licenses", headers=H).json()
exp0 = next(x for x in before if x["key"] == key)["expires_at"]
r = c.post(f"/licenses/{key}/extend", headers=H, json={"days": 5})
check("extend +5 days", r.status_code == 200 and r.json()["expires_at"] > exp0, r.text[:120])

# unbind then rebind to device B
r = c.post(f"/licenses/{key}/unbind", headers=H)
check("unbind device", r.status_code == 200, r.text[:120])
r = c.post("/licenses/activate", json={"key": key, "hwid": "HWID-B", "software_slug": one})
check("rebind to device B", r.status_code == 200, r.text[:120])

# products: add a second product
r = c.put(f"/licenses/{key}/products", headers=H, json={"products": [one, two]})
check("set products", r.status_code == 200 and set(r.json()["products"]) == {one, two}, r.text[:120])
r = c.post("/licenses/activate", json={"key": key, "hwid": "HWID-B", "software_slug": two})
check("second product now allowed", r.status_code == 200, r.text[:120])

# all-products license
r = c.post("/licenses", headers=H, json={"days": 1, "software_slug": "*"})
star = r.json()["key"]
r = c.post("/licenses/activate", json={"key": star, "hwid": "HWID-C", "software_slug": two})
check("'*' license works for any product", r.status_code == 200, r.text[:120])

# status endpoint
r = c.post("/licenses/status", json={"key": key, "hwid": "HWID-B", "software_slug": one})
check("status reports bound + matching", r.status_code == 200 and r.json()["hwid_matches"], r.text[:120])

# revoke
for k, h in ((key, "HWID-B"), (star, "HWID-C")):
    r = c.post(f"/licenses/{k}/revoke", headers=H)
    check(f"revoke {k[:12]}", r.status_code == 200, r.text[:120])
    r = c.post("/licenses/activate", json={"key": k, "hwid": h, "software_slug": one})
    check(f"revoked key refused {k[:12]}", r.status_code == 403, str(r.status_code))

# bad inputs
r = c.post("/licenses/activate", json={"key": "LIC-NOPE", "hwid": "X", "software_slug": one})
check("unknown key refused", r.status_code == 401, str(r.status_code))
r = c.get("/licenses")
check("license list needs admin login", r.status_code in (401, 403), str(r.status_code))

# audit trail recorded
audit = c.get("/audit", headers=H).json()
acts = {a["action"] for a in audit if a["target"] == key}
check("audit has create/extend/unbind/revoke", {"create_license", "extend_license", "unbind_license", "revoke_license"} <= acts, str(acts))

print()
print("LICENSE LIFECYCLE OK" if not fails else f"{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
