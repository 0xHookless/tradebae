"""Per-client-IP rate limiting that works behind a Cloudflare tunnel.

cloudflared terminates the connection locally, so the socket peer is always 127.0.0.1.
The real client address arrives in CF-Connecting-IP (set by Cloudflare) or
X-Forwarded-For, so we key the limiter on that. In-memory, fixed-window; fine for the
single-worker SQLite deployment this ships as.
"""
import threading
import time

from fastapi.responses import JSONResponse


def _client_ip(headers, fallback):
    h = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in headers}
    cf = h.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = h.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return fallback


class RateLimitMiddleware:
    """Fixed-window per-IP limiter with a tighter bucket for sensitive endpoints.

    general   = (max_requests, window_seconds) for everything
    sensitive = (max_requests, window_seconds) for auth/activation/status/check
    """

    def __init__(self, app, general=(240, 60), sensitive=(20, 60),
                 sensitive_prefixes=("/auth/login", "/licenses/activate",
                                     "/licenses/status", "/licenses/check")):
        self.app = app
        self.general = general
        self.sensitive = sensitive
        self.sensitive_prefixes = sensitive_prefixes
        self.hits = {}            # (ip, bucket) -> [count, window_start]
        self.lock = threading.Lock()
        self.last_gc = time.time()

    def _is_sensitive(self, path):
        return any(path.startswith(p) for p in self.sensitive_prefixes)

    def _allow(self, ip, path):
        if self._is_sensitive(path):
            limit, window, bucket = self.sensitive[0], self.sensitive[1], "s"
        else:
            limit, window, bucket = self.general[0], self.general[1], "g"
        now = time.time()
        key = (ip, bucket)
        with self.lock:
            if now - self.last_gc > 300:
                self.hits = {k: v for k, v in self.hits.items() if now - v[1] < 300}
                self.last_gc = now
            ent = self.hits.get(key)
            if ent is None or now - ent[1] >= window:
                self.hits[key] = [1, now]
                return True, 0
            if ent[0] >= limit:
                return False, int(window - (now - ent[1])) + 1
            ent[0] += 1
            return True, 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        cf = headers.get("cf-connecting-ip")
        xff = headers.get("x-forwarded-for")
        peer = scope.get("client")
        peer_ip = peer[0] if peer else ""
        # Requests that did not come through the tunnel (no forwarding header) from the
        # machine itself are trusted: the operator, health checks, local tooling. The server
        # binds 127.0.0.1 only, so the single way in from outside is the tunnel, which always
        # stamps CF-Connecting-IP. Those we rate-limit by the real visitor IP.
        if not cf and not xff and peer_ip in ("127.0.0.1", "::1", "localhost", ""):
            await self.app(scope, receive, send)
            return
        ip = cf.strip() if cf else (xff.split(",")[0].strip() if xff else peer_ip)
        path = scope.get("path", "")
        ok, retry = self._allow(ip, path)
        if not ok:
            resp = JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Slow down and try again shortly."},
                headers={"Retry-After": str(retry)},
            )
            await resp(scope, receive, send)
            return
        await self.app(scope, receive, send)
