from pathlib import Path

BLOCKED_EXTENSIONS = {
    ".env", ".pem", ".key", ".pfx", ".p12", ".crt", ".cer",
    ".id0", ".id1", ".id2", ".nam", ".til", ".bak", ".tmp", ".temp",
    ".rar", ".7z", ".zip", ".tar", ".gz", ".bz2", ".xz",
    ".log", ".db", ".sqlite", ".sqlite3",
    ".kdbx", ".ovpn", ".rdp",
}

BLOCKED_NAMES = {
    "thumbs.db", "desktop.ini", ".ds_store", "id_rsa", "id_ed25519",
    "credentials", "secrets.json", ".npmrc", ".netrc",
}

BLOCKED_SEGMENTS = {
    "backups", "backup", "backup_working", "crashreports", "logs",
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".cache",
    "tradeaccountdata", "tradeactivitylogs", "downloadedinstallationfiles",
}

# Only the separately managed executable upload may carry these names.
EXECUTABLE_ONLY_NAMES = {"sierrachart_64.exe"}

# PyInstaller bundles legitimately ship a nested .zip (the frozen stdlib) and a
# CA bundle under _internal/. Blocklisting those extensions would break any
# distributed runtime; these fixed names are allowed.
BUNDLE_REQUIRED_NAMES = {
    "base_library.zip",
    "cacert.pem",
}

def validate_upload(relative_path: str, role: str, size: int, max_size: int = 512 * 1024 * 1024):
    p = relative_path.replace("\\", "/")
    parts = [x.lower() for x in p.split("/") if x]
    if not parts:
        return "Empty path"
    name = parts[-1]
    if size <= 0:
        return "Empty file"
    if size > max_size:
        return "File exceeds maximum allowed size"
    if name in BLOCKED_NAMES:
        return f"File name '{name}' is excluded"
    if name not in BUNDLE_REQUIRED_NAMES:
        if name in BLOCKED_EXTENSIONS or name.startswith(".env"):
            # dotfiles such as ".env" have no suffix in Python, so match the whole name
            return f"File name '{name}' is excluded"
        ext = Path(name).suffix.lower()
        if ext in BLOCKED_EXTENSIONS:
            return f"File extension '{ext}' is excluded"
    for seg in parts[:-1]:
        for blocked in BLOCKED_SEGMENTS:
            if seg == blocked or seg.startswith(blocked + "_"):
                return f"Directory '{seg}' is excluded"
    if role != "executable" and name in EXECUTABLE_ONLY_NAMES:
        return f"'{name}' must be uploaded as the managed executable, not a normal file"
    if role == "executable" and size < 1024:
        return "Executable payload is too small to be valid"
    if role not in ("normal", "executable"):
        return "Invalid file role"
    return None
