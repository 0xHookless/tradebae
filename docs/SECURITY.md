# Security Notes

## Authentication
- Admin passwords are hashed with Argon2id (`argon2-cffi`).
- Access and refresh tokens are JWTs signed with `SECRET_KEY`; access tokens expire in
  60 minutes, refresh tokens in 7 days.
- Login is rate limited (5/minute per address).
- Admin endpoints require `Authorization: Bearer <access token>`.
- No default production credentials; the bootstrap admin comes from `.env`.

## Transport and at rest
- TLS must be terminated in front of uvicorn in production.
- Uploaded binaries are encrypted with AES-256-GCM (random 96-bit nonce per file,
  authentication tag validated on read).
- Encryption keys are never stored in the client. The client only ever receives
  plaintext over TLS for files it is licensed to download.
- The client stores the managed executable payload DPAPI-encrypted under
  `%APPDATA%\TradingPlatform\TradingLauncher\cache`.
- Manifest and license signatures use ECDSA P-256; the client pins the public key.

## Upload validation / exclusions
Normal uploads are rejected when the relative path contains:
- blocked directories: `Backups`, `BACKUP_WORKING*`, `CrashReports`, `logs`, `.git`,
  `.svn`, `.hg`, `node_modules`, `__pycache__`, `.cache`, `TradeAccountData`,
  `TradeActivityLogs`, `DownloadedInstallationFiles`
- blocked extensions: `.env`, `.pem`, `.key`, `.pfx`, `.p12`, `.crt`, `.cer`, `.id0`,
  `.id1`, `.id2`, `.nam`, `.til`, `.bak`, `.tmp`, `.temp`, `.rar`, `.7z`, `.zip`,
  `.tar`, `.gz`, `.bz2`, `.xz`, `.log`, `.db`, `.sqlite`, `.sqlite3`, `.kdbx`,
  `.ovpn`, `.rdp`
- blocked names: `Thumbs.db`, `desktop.ini`, `.DS_Store`, `id_rsa`, `id_ed25519`,
  `credentials`, `secrets.json`, `.npmrc`, `.netrc`
- `SierraChart_64.exe` unless uploaded with role `executable`

Uploads are size-limited (512 MiB) and stored under server-generated UUID names.
Path traversal, absolute paths, and drive letters are rejected at upload and again
during client install.

## License / HWID
- A license has a key, optional expiry, optional software scope, and a bound HWID.
- First `/licenses/activate` binds the HWID. Subsequent launches from another machine
  are rejected while the server is online.
- Licenses can be extended and revoked by an admin.
- The server issues a signed license token cached by the client, so a launch can proceed
  while the server is down. The token expires at the license expiry. Revocation is
  enforced on the next server contact.

## Logging
- Audit events record actor, action, target, and a short detail string.
- Passwords, tokens, encryption keys, and license keys are not written to logs.
- HTTP errors to clients do not include filesystem paths or stack traces.

## Known limitations
- SQLite and local storage are single-instance; scale out with PostgreSQL/object storage.
- ECDSA pinning trusts the key compiled into the client. Distribute client builds over a
  trusted channel and rotate both sides together.
- Reflective loading of arbitrary full GUI applications can fail for programs that assume
  they are the process image (`GetModuleFileName(NULL)`, process-wide state). Sierra Chart
  is intentionally launched through the reflective path; other applications can be set to
  normal package/launch mode in the admin panel.
- Revocation cannot reach a fully offline client until it reconnects; expiry still applies.
