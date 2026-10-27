# Trade Bay backend on your VPS (DeepCharts, public via Cloudflare)

This runs the backend that lets your users install **DeepCharts** themselves, reachable on a
public `https://....trycloudflare.com` address. No domain, no Node, no build tools needed.

**DeepCharts** is the live app — it has a published build and its data-stack proxy bundled.
The other platforms in the catalog (ATAS, Bookmap, MotiveWave, Sierra Chart) are **placeholders
with no builds**, so there's nothing to install for them; leave them as they are.

---

## One-time setup

1. **Copy the files.** Drag `TradeBayServer.zip` into the VPS over RDP, right-click →
   **Extract All** → extract to `C:\TradeBayServer`.

2. **Install Python** 3.11 or newer from <https://www.python.org/downloads/windows/>.
   In the installer, **tick "Add python.exe to PATH"**, then Install.

3. **Run `setup.bat`** (double-click). It installs what the server needs and creates
   `server\.env` with fresh random secrets. It asks you to set an **admin password** — pick
   one (12+ characters) or press Enter to have one generated. **Write it down.**

---

## Start it (every time)

Double-click **`start-tunnel.bat`**.

- It starts the backend, downloads `cloudflared` the first time, and opens the public tunnel.
- Two windows open — a **server** window and a **tunnel** window. **Leave both open.**
- In the tunnel window, find the line like:

  ```
  https://random-words-1234.trycloudflare.com
  ```

  **That is your public address.** Give it to your users.

To stop everything, close both windows.

> The `trycloudflare.com` address is **new every time you restart**. For a fixed address you'd
> need a free Cloudflare account and a named tunnel — ask and I can set that up. For now,
> whenever you restart, hand out the new URL.

---

## Publish the DeepCharts build (once, required)

A fresh server starts empty — users can't install DeepCharts until you publish a build **on the
VPS**. Do this once, using your own DeepCharts build files:

1. Open `https://....trycloudflare.com/admin/` and sign in (`admin` + the password from setup).
2. **Catalog → DeepCharts → New release** → give it a version (e.g. `1.2.2`).
3. In **Upload payload**, drop your `Deepchart.Core.exe`.
4. In **Upload package zip**, drop a single `.zip` of everything else your build needs — most
   importantly the `proxy\` folder (`DeepChartsProxy`, `DeepChartsHistServer`, the bridge). The
   server strips any personal/secret files automatically.
5. Click **Publish**.

After this, DeepCharts shows a real build and the proxy stack ships to every user who installs it.
To release an update later, repeat with a new version number.

> The payload is encrypted per-server, so you publish from **your build files**, not by copying
> another server's data. Your build is at `...\DeepCharts-Silent\` (payload `Deepchart.Core.exe`).

---

## Point users at it

In the DeepCharts launcher's **Settings**, set the server address to your
`https://....trycloudflare.com` URL. Then they activate their license key and install
DeepCharts. The launcher downloads the build, starts the local proxy stack, and launches it.
(The tunnel gives you real HTTPS, so traffic is encrypted.)

---

## Create a license for a user

1. Open `https://....trycloudflare.com/admin/` and sign in.
2. **Licenses → New license** → choose how many days → create → copy the key → send it to the user.
   Extend, revoke, or unbind (move to a new PC) any key from its **Manage** button.

---

## What's protected

- **HTTPS** via the Cloudflare tunnel.
- **Rate limiting**, per real visitor IP (read from Cloudflare's header, so the tunnel doesn't
  make everyone look like one address): ~240 requests/minute general, and a tight ~20/minute on
  sign-in, license activation and status checks. Over the limit returns `429`.
- **Admin login**: locks an account for 15 minutes after 10 failed attempts.
- **Admin password**: set by you at setup; never shipped in the zip.
- **Uploads**: personal/secret files (`.env`, keys, `Backups\`, `.log`, `.rar`/archives,
  databases, caches, etc.) are refused and stripped from any uploaded package, so they can't be
  served to users by accident.
- **DeepCharts** is the only platform with a published build; the other catalog names are empty
  placeholders with nothing to download.

---

## Back up

Run **`backup.bat`** now and then. It zips `data.db`, `.env`, the signing key and `storage\`
into `backups\`. Move that off the VPS. Two things must never be lost or changed after first
run: `server\.env` (holds the master encryption key) and `server\app\signing_key.pem` (the
launcher trusts it).

---

## If something's wrong

| Problem | Fix |
|---|---|
| `setup.bat` says Python is missing | Install Python, tick "Add to PATH", reopen, run again. |
| Tunnel window shows no `trycloudflare.com` URL | Close it and run `start-tunnel.bat` again; Cloudflare occasionally drops a tunnel. Check the VPS has internet. |
| cloudflared won't download | Download `cloudflared-windows-amd64.exe` manually from the Cloudflare GitHub releases page, rename it to `cloudflared.exe`, put it next to `start-tunnel.bat`. |
| "Too many requests" (429) | The rate limit. Wait a minute. Raise it in `server\app\ratelimit.py` if you genuinely need more. |
| Forgot the admin password | It's only used on first run. Don't delete `data.db` (it holds every license). Sign in and use **Change password**, or ask for help. |
| Users can't reach it | Make sure both windows are open and the tunnel URL is the current one. |

---

## Notes

- Keep `TradeBayServer.zip` private — it contains the server's private signing key. Delete it
  from the VPS after extracting.
- The server runs on `127.0.0.1:8000` locally and is only reachable through the tunnel, so you
  don't need to open any Windows firewall ports.
- To keep it running after a reboot without logging in, use Task Scheduler ("At startup",
  run `start-tunnel.bat`); otherwise put a shortcut to it in `shell:startup`.
