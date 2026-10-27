# Deployment

## Production topology

```
Internet ── TLS ──> nginx/Caddy (443)
                      ├─ /admin, /auth, /catalog, /download, /licenses, /software, /audit, /health
                      └─ uvicorn 127.0.0.1:8000  (FastAPI)
                            ├─ data.db (SQLite)
                            ├─ storage/binaries/*.bin (AES-256-GCM)
                            └─ app/signing_key.pem (private key, 0600)
```

Terminate TLS at the reverse proxy. Never expose uvicorn directly.

## Required environment

Copy `server/.env.example` to `server/.env` and set:

```ini
SECRET_KEY=<64+ random chars>
MASTER_ENCRYPTION_KEY=<base64 of 32 random bytes>
LICENSE_SECRET=<random>
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=<strong password>
DATABASE_URL=sqlite:///./data.db
```

Generate keys:

```powershell
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
```

`MASTER_ENCRYPTION_KEY` must stay stable: rotating it makes existing encrypted blobs
unreadable. Keep a backup in a secrets manager.

## Run

```powershell
cd C:\TradingPlatform\server
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

SQLite requires a single worker. For multi-worker deployments move to PostgreSQL and
shared storage, or put the binary store behind an object store.

## Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name launcher.example.com;

    ssl_certificate     /etc/ssl/fullchain.pem;
    ssl_certificate_key /etc/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 512m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
```

Add HSTS and a strict `Content-Security-Policy` at the proxy for the admin SPA.

## Backup

Back up together:
- `data.db`
- `app/signing_key.pem`
- `storage/binaries/`
- `MASTER_ENCRYPTION_KEY` (separately, e.g. secrets manager)

A backup without the master key cannot restore binaries.

## Admin bootstrap
The first start creates the admin from the environment. Change the bootstrap password
immediately after first login. There is intentionally no hardcoded default admin.

## Client distribution
Build `TradingLauncher.exe` with the pinned public key matching the deployed server.
Ship the `Release` folder produced by `windeployqt` (exe + Qt DLLs + plugins).
