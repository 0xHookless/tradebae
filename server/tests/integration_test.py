import base64, hashlib, json, sys, time
import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

BASE = "http://127.0.0.1:8000"

def main():
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json={"username": "admin", "password": "ChangeMe123!"}, timeout=10)
    assert r.status_code == 200, r.text
    hdr = {"Authorization": "Bearer " + r.json()["access_token"]}

    cat = s.get(f"{BASE}/catalog", timeout=10).json()
    sw = next(x for x in cat if x["slug"] == "sierra-chart")
    assert sw["separate_executable"] is True

    ver = "test-" + str(int(time.time()))
    r = s.post(f"{BASE}/releases/sierra-chart", json={"version": ver}, headers=hdr, timeout=10)
    assert r.status_code == 200, r.text
    rel = r.json()
    rid = rel["id"]

    files = {
        "data/sample.txt": b"hello trading",
        "data/sub/nested.bin": bytes(range(64)),
        "TestDll.dll": b"MZfake-dll-content",
    }
    for path, data in files.items():
        r = s.post(f"{BASE}/release/{rid}/upload", headers=hdr,
                   data={"relative_path": path, "role": "normal"},
                   files={"file": (path.split("/")[-1], data)}, timeout=10)
        assert r.status_code == 200, r.text

    payload = open(r"C:\TradingPlatform\testdata\marker.exe", "rb").read()
    r = s.post(f"{BASE}/release/{rid}/upload", headers=hdr,
               data={"relative_path": "SierraChart_64.exe", "role": "executable"},
               files={"file": ("SierraChart_64.exe", payload)}, timeout=30)
    assert r.status_code == 200, r.text

    # Path traversal must be rejected
    r = s.post(f"{BASE}/release/{rid}/upload", headers=hdr,
               data={"relative_path": "../evil.txt", "role": "normal"},
               files={"file": ("evil.txt", b"x")}, timeout=10)
    assert r.status_code == 400, r.text

    # Exclusion rules must reject personal archives and the managed-exe-as-normal-file
    r = s.post(f"{BASE}/release/{rid}/upload", headers=hdr,
               data={"relative_path": "docs/personal.rar", "role": "normal"},
               files={"file": ("personal.rar", b"x" * 64)}, timeout=10)
    assert r.status_code == 400, r.text
    r = s.post(f"{BASE}/release/{rid}/upload", headers=hdr,
               data={"relative_path": "SierraChart_64.exe", "role": "normal"},
               files={"file": ("SierraChart_64.exe", b"x" * 2048)}, timeout=10)
    assert r.status_code == 400, r.text

    r = s.post(f"{BASE}/release/{rid}/publish", headers=hdr, timeout=10)
    assert r.status_code == 200, r.text

    r = s.get(f"{BASE}/catalog/sierra-chart/manifest", timeout=10)
    assert r.status_code == 200, r.text
    mo = r.json()
    raw = mo["manifest_raw"].encode()
    sig = base64.b64decode(mo["signature"])
    key = s.get(f"{BASE}/licenses/public-key", timeout=10).json()
    x = int.from_bytes(base64.b64decode(key["x"]), "big")
    y = int.from_bytes(base64.b64decode(key["y"]), "big")
    pub = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()
    r_int = int.from_bytes(sig[:32], "big")
    s_int = int.from_bytes(sig[32:], "big")
    pub.verify(encode_dss_signature(r_int, s_int), raw, ec.ECDSA(hashes.SHA256()))

    manifest = json.loads(raw)
    roles = {f["role"] for f in manifest["files"]}
    assert "executable" in roles
    assert any(f["relative_path"] == "data/sample.txt" for f in manifest["files"])

    # License
    r = s.post(f"{BASE}/licenses", json={"days": 30, "software_slug": "*"}, headers=hdr, timeout=10)
    assert r.status_code == 200, r.text
    lic = r.json()
    key_str = lic["key"]

    hwid = "a" * 64
    r = s.post(f"{BASE}/licenses/activate", json={"key": key_str, "hwid": hwid, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 200, r.text
    token = r.json()["license_token"]
    assert token.count(".") == 1

    # Unauthorized download
    r = s.get(f"{BASE}/download/sierra-chart/{ver}/data/sample.txt", timeout=10)
    assert r.status_code == 401, (r.status_code, r.text)

    # Authorized downloads + hash verification
    for f in manifest["files"]:
        r = s.get(f"{BASE}/download/sierra-chart/{ver}/{f['relative_path']}",
                  params={"license_key": key_str, "hwid": hwid}, timeout=30)
        assert r.status_code == 200, (f["relative_path"], r.status_code, r.text)
        assert hashlib.sha256(r.content).hexdigest() == f["sha256"], f["relative_path"]

    # Revoked license cannot download
    s.post(f"{BASE}/licenses/{key_str}/revoke", headers=hdr, timeout=10)
    r = s.get(f"{BASE}/download/sierra-chart/{ver}/data/sample.txt",
              params={"license_key": key_str, "hwid": hwid}, timeout=10)
    assert r.status_code == 403, (r.status_code, r.text)

    # Extend works on another license
    r = s.post(f"{BASE}/licenses", json={"days": 1, "software_slug": "*"}, headers=hdr, timeout=10)
    k2 = r.json()["key"]
    r = s.post(f"{BASE}/licenses/{k2}/extend", json={"days": 5}, headers=hdr, timeout=10)
    assert r.status_code == 200, r.text

    # ---- License status endpoint: must never bind ----
    # Unknown key -> 404
    r = s.post(f"{BASE}/licenses/status", json={"key": "LIC-00000000000000000000000000000000", "hwid": hwid, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 404, (r.status_code, r.text)

    # Status against an unbound, unexpired key must NOT create a binding
    r = s.post(f"{BASE}/licenses", json={"days": 7, "software_slug": "*"}, headers=hdr, timeout=10)
    k3 = r.json()["key"]
    r = s.post(f"{BASE}/licenses/status", json={"key": k3, "hwid": hwid, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 200, (r.status_code, r.text)
    st = r.json()
    assert st["revoked"] is False and st["expired"] is False and st["bound"] is False, st

    # Status by another admin must not leak the key's hwid in the list
    r = s.get(f"{BASE}/licenses", headers=hdr, timeout=10)
    assert r.status_code == 200, r.text
    for row in r.json():
        if row["key"] in {key_str, k3}:
            assert "hwid" not in row or row["hwid"] in (None, ""), "full hwid leaked via /licenses"

    # ---- Cross-HWID rejection ----
    r = s.post(f"{BASE}/licenses/activate", json={"key": k3, "hwid": hwid, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 200, r.text
    r = s.post(f"{BASE}/licenses/activate", json={"key": k3, "hwid": "b" * 64, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 403, (r.status_code, r.text)
    # status endpoint also reflects the mismatch without rebinding
    r = s.post(f"{BASE}/licenses/status", json={"key": k3, "hwid": "b" * 64, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["bound"] is True and st["hwid_matches"] is False, st
    assert st["bound_hwid_masked"].startswith("a") or st["bound_hwid_masked"] == "", st

    # ---- Unbind ----
    r = s.post(f"{BASE}/licenses/{k3}/unbind", headers=hdr, timeout=10)
    assert r.status_code == 200, r.text
    r = s.post(f"{BASE}/licenses/status", json={"key": k3, "hwid": hwid, "software_slug": "sierra-chart"}, timeout=10)
    st = r.json()
    assert st["bound"] is False, st
    # Token issued before unbind must no longer authorize a download
    r = s.post(f"{BASE}/licenses/activate", json={"key": k3, "hwid": "c" * 64, "software_slug": "sierra-chart"}, timeout=10)
    assert r.status_code == 200, r.text
    tok2 = r.json()["license_token"]
    r = s.get(f"{BASE}/download/sierra-chart/{ver}/data/sample.txt",
              params={"license_token": tok2}, timeout=10)
    assert r.status_code == 403, (r.status_code, "stale-HWID token accepted after unbind+rebind")

    print("INTEGRATION OK", ver)

if __name__ == "__main__":
    main()
