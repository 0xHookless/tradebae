# Manifest Format

The server publishes an immutable release manifest. The client refuses manifests whose
signature does not verify against the pinned ECDSA P-256 public key.

## Published response

`GET /catalog/{slug}/manifest?version=latest`

```json
{
  "app_id": "sierra-chart",
  "display_name": "Sierra Chart",
  "release_version": "1.4.2",
  "manifest_version": 1,
  "total_size": 18432001,
  "manifest_raw": "{\"app_id\":\"sierra-chart\",...}",
  "signature": "base64(r||s, 64 bytes)",
  "signing_key": "/licenses/public-key"
}
```

- `manifest_raw` is the exact UTF-8 byte sequence that was signed
  (`json.dumps(manifest, sort_keys=True)` at publish time).
- `signature` is an ECDSA P-256 / SHA-256 signature over `manifest_raw`, encoded as
  IEEE P1363 (32-byte R followed by 32-byte S), then base64.
- The client verifies the signature before reading any hash from the manifest.

## Manifest body

```json
{
  "app_id": "sierra-chart",
  "display_name": "Sierra Chart",
  "release_version": "1.4.2",
  "manifest_version": 1,
  "published_at": "2026-10-20T12:00:00Z",
  "total_size": 18432001,
  "files": [
    {
      "relative_path": "Data/DefaultSettings.cfg",
      "size": 1024,
      "sha256": "hex-64",
      "role": "normal",
      "required": true
    },
    {
      "relative_path": "SierraChart_64.exe",
      "size": 30460288,
      "sha256": "hex-64",
      "role": "executable",
      "required": true
    }
  ]
}
```

Rules:
- `relative_path` is always relative, uses `/`, and must not contain `..`, a drive letter,
  or a leading slash. The client re-validates and resolves it under the install directory.
- `role` is `normal` or `executable`. A release has at most one managed executable per app.
- `required` files must exist and hash-match before launch.
- `manifest_version` is checked by the client; unknown versions are rejected.

## Signing key lifecycle
- Private key: `server/app/signing_key.pem` (generated on first start if absent).
- Public key: pinned in `client/src/ClientKeys.h` as raw X/Y coordinates.
- To rotate: generate a new key, deploy the new public key in a client build, then publish
  new releases. Old clients will reject new manifests until updated.
