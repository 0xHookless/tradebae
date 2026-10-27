# Trading Platform Distribution System

Secure catalog, packaging, licensing, and reflective-launch system for Windows trading
applications (ATAS, ATAS X, Bookmap, MotiveWave, Sierra Chart).

```
C:\TradingPlatform
├─ server/     FastAPI backend + encrypted binary store + admin API
├─ admin/      React/Vite admin SPA (built into admin/dist)
├─ client/     Qt 6 / C++ Windows launcher + reflective PE loader
├─ shared/     manifest schema
├─ docs/       deployment, security, manifest reference
└─ testdata/   harmless test artifacts used by the integration tests
```

## Components

### Server (`server/`)
- FastAPI + SQLite (SQLAlchemy).
- Argon2id admin password hashing, JWT access/refresh tokens, login rate limiting.
- Software catalog, draft releases, per-file uploads, manifest generation, ECDSA P-256
  manifest signing, publish + rollback.
- AES-256-GCM encryption at rest for every uploaded binary; keys derived from
  `MASTER_ENCRYPTION_KEY` (or `SECRET_KEY` fallback in development).
- License engine: create for N days, extend, revoke; first activation binds a HWID.
- Signed license tokens cached by the client for offline launch.
- Audit log, health endpoint, upload exclusion rules.

### Admin panel (`admin/`)
- Login, overview, software create/edit, release upload/review/publish/rollback.
- Separate normal-file and managed-executable handling per application.
- License creation, extension, revocation, HWID display, audit log.

### Client (`client/`)
- Qt 6 Widgets dark UI, five application tabs, adaptive primary action.
- Catalog + signature-verified manifest client, SHA-256 integrity verification.
- Only missing/changed files are downloaded, into a per-app install directory.
- Managed executable is fetched separately, cached DPAPI-encrypted, and mapped
  into memory by a real x64 PE loader (sections, relocations, imports, entry point).
- Offline behavior: cached signed manifest + cached encrypted payload allow launch
  when the server is down, until the license expires.

## Quick start (development)

```powershell
# 1. Server dependencies
cd C:\TradingPlatform\server
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env: set SECRET_KEY, MASTER_ENCRYPTION_KEY, ADMIN_BOOTSTRAP_PASSWORD

# 2. Run the server (serves admin at /admin)
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. Admin panel
#    http://127.0.0.1:8000/admin
#    default bootstrap login comes from .env (change it before exposing the server)

# 4. Build the launcher
cd C:\TradingPlatform\client
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 `
  -DCMAKE_PREFIX_PATH="C:/Qt/6.8.3/msvc2022_64"
cmake --build build --config Release
# output: client/build/Release/TradingLauncher.exe (Qt runtime deployed beside it)
```

The launcher's Settings panel takes the server URL and license key. Create a license in
the admin panel, paste it into the launcher, then Install/Launch.

## Packaging workflow

1. Admin → Software → select app → **New Software** if needed.
2. **Create Draft Release** with a version string.
3. Upload normal files with their relative paths (`bin/app.dll`, `config/default.ini`, ...).
4. Upload the managed executable separately with role `executable`
   (for Sierra Chart: `SierraChart_64.exe`).
5. Review the file inventory and SHA-256 values.
6. **Publish Release**. Roll back with **Make Latest** on an older release.

Normal uploads reject personal archives, backups, logs, credentials, keys, caches,
source-control metadata, and `SierraChart_64.exe` when uploaded as a normal file.
See `docs/SECURITY.md` for the full exclusion list.

## Tests

```powershell
# Server integration (login, upload, exclusion rejection, publish,
# signature verification, licensed download, hash verification, revoke)
cd C:\TradingPlatform\server
python tests\integration_test.py

# Reflective loader (maps a harmless test EXE, verifies its entry point ran)
client\build\Release\LoaderTest.exe testdata\marker.exe

# Full client flow (catalog, manifest, license, install, reflective launch)
client\build\Release\ClientFlowTest.exe http://127.0.0.1:8000 <license-key>
```

## Documentation
- `docs/MANIFEST.md` — manifest format and signing.
- `docs/DEPLOYMENT.md` — production deployment, TLS, backups, key rotation.
- `docs/SECURITY.md` — threat model, exclusions, secrets, limitations.

## Important notes
- Set real secrets in `.env`; never commit `.env`, `data.db`, `app/signing_key.pem`,
  `server/storage/`, or certificates.
- Production must terminate TLS (nginx/Caddy/IIS) in front of uvicorn.
- The launcher pins the ECDSA public key in `client/src/ClientKeys.h`. Regenerating the
  server signing key requires rebuilding the client with the new public key.
- Reflective execution of a full GUI application is inherently less compatible than a
  normal process launch (module path, command line, and process-wide state assumptions).
  Sierra Chart is configured as a separately managed executable and is launched this way
  by design.
