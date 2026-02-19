from __future__ import annotations


class UpstreamRateLimitedError(RuntimeError):
    """Raised when upstream website blocks requests (e.g., Cloudflare 1015)."""

