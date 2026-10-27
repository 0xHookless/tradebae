# Changes made, and the API reference

This covers two things: what changed in this working session, and a full reference for
every server endpoint. The client launcher (`client/`) was not touched by any of this.

---

## 1. What changed, in order

### Admin panel: sign-in was broken
`admin/src/api.js` posted the login request to `/auth/change-password-replace-guard`,
which doesn't exist, so every sign-in attempt failed with "Not Found". Fixed to post to
`/auth/login`.

### Admin panel: garbled text
Several files had em dashes and ellipses double-encoded as UTF-8-read-as-Latin-1
(`â€”`, `â€¦`), which rendered as stray glyphs. Fixed across `api.js`, `ui.jsx`,
`Audit.jsx`, `Catalog.jsx`, `Licenses.jsx`, `Overview.jsx`.

### Licenses: couldn't select individual products
Two bugs in the product picker (`ProductEditor` in `ui.jsx`):
- Clicking a product checkbox crashed instead of toggling it.
- Unchecking "All products" left an inconsistent state instead of an empty selection.

And one bug in the Manage dialog (`Licenses.jsx`): saving a changed product list sent a
bare array (`["atas","bookmap"]`) where the server's `PUT /licenses/{key}/products`
expects `{"products": [...]}` — every save failed silently.

All three fixed. The UI now also refuses to create or save a license with zero products
selected, and shows a visible warning instead of silently defaulting to "all products".

### Server: license server config simplified in the admin UI
Per an earlier request, Settings in the admin panel was cut down to just the server
address, with the three general toggles (startup, auto-update check, minimise to tray)
and an install-directory field — all of that lives in the **launcher**, not the admin
panel; see the launcher's own Settings panel. The license-server address field here is
what the **launcher** connects to, configured from its own Settings.

### New product: DeepCharts
Added to the server's built-in catalog seed list in `server/app/main.py`
(`DEFAULT_SOFTWARE`). The server inserts any missing entry from that list at every
startup, so it appears automatically — no manual catalog step needed. Executable name
and install folder are placeholders (`DeepCharts.exe`, `DeepCharts`); update them from
Catalog → DeepCharts → Configure once the real values are known.

### Package zip uploads: exclusion rules weren't applied, and `.env` wasn't blocked at all
`POST /release/{id}/zip` (the "drop one zip with everything in it" upload) didn't run
the same exclusion checks as the single-file upload route. A zip containing `.env`,
files in a `Backups/` folder, `.rar` archives, `.log` files, etc. was accepted and
shipped to customers as-is.

Also, independent of the zip changes: `.env` was never blocked by the single-file route
either, because `Path(".env").suffix` is `""` in Python, not `.env` — the extension
check never matched it.

Fixed:
- The zip route now runs every entry through the same `validate_upload()` rules as
  single-file uploads, rebuilds the stored zip without the excluded entries, and
  returns a `skipped` list naming what was left out and why.
- `.env` (and `.env.anything`) is now blocked by file name, not just by extension.
- The upload is streamed to disk in 1 MB chunks instead of being read fully into memory
  first, so a large upload doesn't exhaust RAM on a small VPS.

### Admin panel: no drag-and-drop for the package zip
Added a real drop zone (`.dropzone` in `Catalog.jsx` / `theme.css`): drag a `.zip` onto
it, or click it to browse. After upload it shows how many files were included and lists
any that were excluded, with the reason for each. Dropping onto a draft that already
has files asks for confirmation before replacing them.

### Payload vs. package: now two separate uploads
This was the last and biggest change. Not every `.exe` in a release is the thing the
launcher reflectively loads — some are helper tools, installers, etc. that should just
be ordinary package files. Previously the package-zip route auto-tagged every `.exe` by
extension as the managed "executable" role, which was both wrong for those files and
made it ambiguous which one was ever actually meant as the payload.

Changes:
- **New endpoint**: `POST /release/{id}/payload` — uploads the one managed executable
  for a release, separately from the package. One per release; uploading again replaces
  the previous one. Encrypted at rest like any single-file upload. Rejects a filename
  with a folder in it, a filename that collides with an existing package file, anything
  that isn't big enough or doesn't start with the Windows `MZ` header.
- The package-zip route (`POST /release/{id}/zip`) no longer tags `.exe` files as the
  payload — every entry in a package zip is now an ordinary file. It also refuses a zip
  whose top-level name matches the release's current payload.
- `POST /release/{id}/publish` now requires a payload to exist first, for any software
  whose `separate_executable` flag is set (that's all five seeded platforms).
- Fixed a related server bug this change exposed: `GET /download/{slug}/{version}/{path}`
  crashed with a 500 for any file that came from a package zip (those files have no
  individual encrypted blob — only the combined zip is stored). It now extracts that one
  entry from the cached zip on demand instead of crashing.
- Admin panel: added an **"Upload payload"** section above "Add files" / "Upload package
  zip" on a draft release, with its own drop zone, a note explaining what it's for, and
  a line showing the current payload's name, size and hash once one exists. The file
  list now labels that row **payload** instead of the old internal name "executable".

### Deployment zip
`TradeBayServer.zip` and the `deploy/` scripts (`setup.bat`, `start.bat`, `backup.bat`,
`setup_env.py`, `README-VPS.md`) were added so the server + prebuilt admin panel can be
dropped onto a Windows VPS without Node or a C++ toolchain. It's been rebuilt after every
fix above. See `deploy/README-VPS.md` for the walkthrough.

### Testing
Three test scripts now exist under `server/tests/` and were run against a live server
after every change in this session:
- `integration_test.py` — the original: login, upload, exclusion rejection, publish,
  signature verification, licensed download, hash verification, revoke.
- `license_lifecycle_test.py` — create, activate + HWID bind, refuse a second device,
  refuse a different product, extend, unbind, rebind, change products, `"*"` licenses,
  status, revoke, bad-input handling, audit trail. 22 checks.
- `payload_test.py` — payload vs. package separation specifically: publish blocked with
  no payload, payload/non-exe/collision rejection rules, payload absent from the shipped
  zip, licensed download of both the payload and a normal file. 20 checks.

Run any of them against a running server:
```powershell
cd server
python tests\integration_test.py [base_url] [admin_user] [admin_password]
python tests\license_lifecycle_test.py [base_url] [admin_user] [admin_password]
python tests\payload_test.py [base_url] [admin_user] [admin_password]
```
All arguments are optional and default to the local dev server with the default bootstrap
password.

### Known gaps, not fixed in this session
- **No delete-release endpoint.** A draft release can't be removed from the admin panel
  once created — only deleting the whole application removes its releases. A stray test
  draft (`ui-demo-1` under Sierra Chart) was left behind from UI testing; it's
  unpublished and harmless.
- **Package zip isn't encrypted at rest.** Single files uploaded individually (including
  the payload) are AES-256-GCM encrypted on disk; the whole-package zip from
  `POST /release/{id}/zip` is stored as a plain file in `storage/zips/`. This
  contradicts what `README.md` says about "every uploaded binary". Worth deciding
  deliberately rather than leaving implicit.
- **R2 upload flow is unverified.** `r2-upload-url` / `register-zip` exist for an
  object-storage-backed deployment but weren't exercised by any test in this session
  (no R2 credentials configured). Disk-mode (the default, no R2 env vars set) is the
  one that's actually been tested throughout.

---

## 2. API reference

Base URL: whatever `server/.env`'s implied host is — locally `http://127.0.0.1:8000`.
No global prefix except `/auth/*` and `/software/*` (explicit below); every other route
is exactly the path shown.

**Auth model**: JWT access token (60 min) + refresh token (7 days), `HS256`, signed with
`SECRET_KEY`. Admin routes take `Authorization: Bearer <access_token>`. Public routes
(license activation, downloads, catalog browsing) need no admin token — they're gated by
a license key/HWID or a signed license token instead.

### Auth — `/auth/*`

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /auth/login` | none | `{username, password}` | Rate-limited (`rate_limit_login`, default `5/minute`). 10 failed attempts locks the account for 15 minutes (`429`). Returns `{access_token, refresh_token, token_type}`. |
| `POST /auth/refresh` | none (refresh token as query param) | `?refresh_token=...` | Returns a new token pair. |
| `GET /auth/me` | admin | — | `{id, username}` of the caller. |
| `POST /auth/change-password` | admin | `{old_password, new_password}` | |
| `GET /auth/public-key` | none | — | The server's signing public key, PEM. |

### Software catalog — `/software/*` (admin-managed) and `/catalog` (public read)

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `GET /software` | admin | — | Every application, with `latest_version` from its newest published release. |
| `GET /software/{slug}` | admin | — | One application. |
| `POST /software` | admin | `SoftwareCreate` (slug, display_name, description, icon_url, install_dir_name, executable_name, launch_args, separate_executable) | Creates an application. |
| `PUT /software/{slug}` | admin | same shape | Full update. |
| `DELETE /software/{slug}` | admin | — | Deletes the application **and every release and file under it**. Irreversible. |
| `GET /catalog` | none | — | Public version of the list above — what the launcher calls to show available platforms. |

The five seeded applications (plus DeepCharts, added in this session) use
`separate_executable=True`, meaning they need a payload uploaded before their releases
can publish.

### Releases & uploads — no prefix

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /releases/{slug}` | admin | `{version}` | Creates a draft release. |
| `GET /releases/{slug}` | none | — | Every release (draft + published) for an app. |
| `GET /release/{id}` | none | — | One release, with its full file list. |
| `POST /release/{id}/upload` | admin | multipart: `file`, `relative_path`, `role` (`normal`\|`executable`, default `normal`), `required` | Uploads one file into a draft. Rejected if the release already has files from a package zip (mixing the two upload styles is blocked) — remove the zip first. Runs `validate_upload()` exclusion rules. |
| `POST /release/{id}/payload` | admin | multipart: `file` | **New.** The one managed executable for this release. Filename must be a bare name (no folder), must not collide with an existing package file, must be ≥1 KB and start with `MZ`. Replaces any previous payload (old one is deleted). |
| `POST /release/{id}/zip` | admin | multipart: `file`, `replace` (bool, default `false`) | Uploads a whole package as one zip. Parses every entry, runs exclusion rules on each, **rebuilds the stored zip without excluded entries**, and returns `{ok, version, files, skipped, zip_sha256, zip_size}` where `skipped` is `[{path, reason}, ...]`. Every entry becomes an ordinary file (`role="normal"`) — it never auto-detects a payload. Refuses an entry whose top-level name matches the release's existing payload. `replace=true` to overwrite files already uploaded into this draft (payload is untouched either way — it's managed separately). Streams to disk; max 3 GB. |
| `DELETE /release/{id}/files/{file_id}` | admin | — | Deletes one file from a draft (not published). |
| `POST /release/{id}/publish` | admin | — | Builds the shipped zip (from uploaded blobs, or ships the already-uploaded package zip as-is if that's how files were added), signs the manifest, marks the release published. **Refuses if the app is `separate_executable` and no payload has been uploaded.** Immutable after this — no more file changes. |
| `POST /release/{id}/republish` | admin | — | Re-stamps an already-published release's `published_at`, effectively marking it "latest" again without re-uploading anything (used for rollback to an older version). |
| `POST /release/{id}/r2-upload-url` | admin | — | Cloudflare R2 mode only (`R2_*` env vars set). Returns a presigned PUT URL for uploading the package zip directly to R2 instead of through the server. `503` if R2 isn't configured. |
| `POST /release/{id}/register-zip` | admin | `{r2_key, sha256, size}` | Companion to the above: after a direct-to-R2 upload, tells the server about it and publishes the release. |

### Downloads — no prefix, public (license-gated)

| Method & path | Auth | Notes |
|---|---|---|
| `GET /catalog/{slug}/manifest?version=latest` | none | Signed manifest for a release: file list, hashes, sizes, roles, `zip_sha256`. `signing_key` field points to `/licenses/public-key` to verify the signature. |
| `POST /download/{slug}/{version}/zip-url` | license | Body: `{key, hwid}` or `{license_token, hwid}`. Returns a URL for the package zip (an R2 presigned URL, or `/download/.../zip-stream` in disk mode) plus its hash and size. |
| `GET /download/{slug}/{version}/zip-stream` | none (URL is short-lived/obscure, not separately checked) | Streams the cached package zip from disk. |
| `GET /download/{slug}/{version}/{relative_path}` | license (query params `license_key` & `hwid`, or `license_token` & `hwid`) | Downloads **one** file by its exact relative path — this is how the launcher fetches the payload. Works whether that file has its own encrypted blob (single uploads, the payload) or came from a package zip (extracted from the cached zip on demand — **fixed in this session**, used to 500). |

### Licenses — no prefix

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /licenses` | admin | `{days, software_slug, note}` | `software_slug`: `"*"` for all products, or a comma-separated list. `days=0` = perpetual (no expiry). Key format: `LIC-` + 32 hex chars. |
| `GET /licenses` | admin | — | Every license. `hwid` is never returned — only `hwid_masked` (first 8 + last 4 chars). |
| `POST /licenses/{key}/revoke` | admin | — | Immediate and permanent for that key. |
| `POST /licenses/{key}/extend` | admin | `{days}` | Adds to the current expiry (or from now, if already expired). |
| `POST /licenses/{key}/unbind` | admin | — | Clears the bound HWID, freeing the key for a different machine. |
| `PUT /licenses/{key}/products` | admin | `{products: "*" \| [slugs]}` | Replaces the full product list for a key — **not** additive; send the complete set you want. Every slug must be a real `software.slug` or `"*"`. (This is the endpoint the admin panel's product picker was failing to call correctly before the fix in this session.) |
| `GET /licenses/public-key` | none | — | ECDSA public key (x, y) used to verify license tokens. |
| `POST /licenses/status` | none | `{key, hwid, software_slug}` | Read-only check: revoked/expired/bound/scope state, no side effects. |
| `POST /licenses/activate` | none | `{key, hwid, software_slug}` | **First call for a key+hwid binds it.** Returns a signed, self-contained license token (`payload_b64.sig`) the client can cache and verify offline. Refuses: unknown key (`401`), revoked/expired/wrong-product/wrong-device (`403`). |
| `POST /licenses/check` | none | `{token}` | Verifies a cached license token's signature and expiry without hitting the database — this is what lets the launcher work while the server is offline. |

### Audit & health — no prefix

| Method & path | Auth | Notes |
|---|---|---|
| `GET /audit` | admin | Most recent 200 events (logins, license and release changes, uploads). |
| `GET /health` | none | `{status: "ok", version: "1.0.0"}`. Used by `setup.bat`/monitoring to confirm the server is up. |

---

## 3. A few things worth knowing operationally

- **License scope string**: `"*"` means every product; otherwise a comma-separated list
  of `software.slug` values, always stored sorted. A single slug with no comma is the
  legacy one-product form — both are accepted everywhere a scope is read.
- **License tokens are offline-verifiable.** They're `base64(json).signature`, ECDSA
  P-256 over the payload, with their own `exp` baked in (perpetual licenses get a
  10-year token expiry rather than a literal "never"). The client can keep using a
  cached token without contacting the server until that `exp` passes.
- **`MASTER_ENCRYPTION_KEY` must never change** once anything has been uploaded — every
  encrypted blob under `storage/binaries/` (including every payload) becomes
  unreadable if it does. Same for the signing key: the launcher pins its public half.
- **A release is immutable once published.** Every upload/delete/payload route checks
  `rel.published` and refuses. The only way to change a published version's files is to
  create a new release and publish that.
- **Payload role is `"executable"` internally** (the `ReleaseFile.role` column), shown
  as **payload** in the admin UI since this session's fix — don't be confused by the two
  different words for the same thing if you're reading the database or the API response
  directly.
