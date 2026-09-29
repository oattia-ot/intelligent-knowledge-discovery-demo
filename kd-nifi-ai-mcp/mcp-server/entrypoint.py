"""
kd-nifi-ai-mcp MCP process = official Cloudera NiFi MCP Server.

Package: nifi-mcp-server
Source:  https://github.com/cloudera/nifi-mcp-server
Run:     nifi_mcp_server.server (FastMCP, transport=sse|http|stdio)

This wrapper only:
  - maps compose env (NIFI_*) onto the official config keys
  - binds 0.0.0.0 so Docker port publish works (upstream default is 127.0.0.1:3030)
  - adds standalone NiFi single-user token auth (POST /nifi-api/access/token)
    because the official client is Knox-oriented
  - waits briefly for NiFi before FastMCP starts
"""

from __future__ import annotations

import os
import sys
import time

# Must be set before nifi_mcp_server.config is imported (dataclass defaults
# are evaluated at import time).
os.environ.setdefault("MCP_TRANSPORT", "sse")
os.environ.setdefault("MCP_HOST", "0.0.0.0")
os.environ.setdefault("MCP_PORT", "8000")
os.environ.setdefault("FASTMCP_HOST", os.environ["MCP_HOST"])
os.environ.setdefault("FASTMCP_PORT", os.environ["MCP_PORT"])
os.environ.setdefault("NIFI_READONLY", "false")
os.environ.setdefault("KNOX_VERIFY_SSL", os.environ.get("NIFI_VERIFY_SSL", "false"))


def _map_compose_env() -> None:
    if os.environ.get("NIFI_BASE_URL") and not os.environ.get("NIFI_API_BASE"):
        os.environ["NIFI_API_BASE"] = os.environ["NIFI_BASE_URL"]
    if os.environ.get("NIFI_USERNAME") and not os.environ.get("KNOX_USER"):
        os.environ["KNOX_USER"] = os.environ["NIFI_USERNAME"]
    if os.environ.get("NIFI_PASSWORD") and not os.environ.get("KNOX_PASSWORD"):
        os.environ["KNOX_PASSWORD"] = os.environ["NIFI_PASSWORD"]
    if os.environ.get("NIFI_VERIFY_SSL") and not os.environ.get("KNOX_VERIFY_SSL"):
        os.environ["KNOX_VERIFY_SSL"] = os.environ["NIFI_VERIFY_SSL"]


def _nifi_bases() -> list[str]:
    raw = [
        os.environ.get("NIFI_API_BASE", ""),
        os.environ.get("NIFI_BASE_URL", ""),
        os.environ.get("NIFI_EXTERNAL_API", ""),
    ]
    raw.extend(p.strip() for p in os.environ.get("NIFI_API_BASES", "").split(",") if p.strip())
    seen: list[str] = []
    for item in raw:
        item = (item or "").strip().rstrip("/")
        if item and item not in seen:
            seen.append(item)
    http_first = [b for b in seen if b.startswith("http://")]
    https = [b for b in seen if b.startswith("https://")]
    return (http_first + https) or ["http://nifi-proxy:8080/nifi-api"]


def _token_ok(resp) -> bool:
    return (
        resp.status_code in (200, 201)
        and bool(resp.text.strip())
        and "<html" not in resp.text.lower()
    )


def wait_for_nifi() -> None:
    import requests

    bases = _nifi_bases()
    user = os.environ.get("NIFI_USERNAME") or os.environ.get("KNOX_USER")
    password = os.environ.get("NIFI_PASSWORD") or os.environ.get("KNOX_PASSWORD")
    verify = os.environ.get("NIFI_VERIFY_SSL", "false").lower() == "true"
    timeout = int(os.environ.get("NIFI_WAIT_SECONDS", "45"))
    deadline = time.time() + timeout
    attempt = 0
    print(f"cloudera nifi-mcp-server: waiting up to {timeout}s for {bases}", flush=True)
    while True:
        attempt += 1
        for base in bases:
            try:
                if user and password:
                    resp = requests.post(
                        base + "/access/token",
                        data={"username": user, "password": password},
                        headers={"Content-Type": "application/x-www-form-urlencoded"},
                        timeout=6,
                        verify=verify,
                    )
                    if _token_ok(resp):
                        os.environ["NIFI_API_BASE"] = base
                        os.environ["NIFI_BASE_URL"] = base
                        print(f"NiFi ready at {base} after {attempt} attempt(s)", flush=True)
                        return
                    print(f"{base} token HTTP {resp.status_code}: {resp.text[:120]}", flush=True)
                else:
                    cfg = requests.get(base + "/access/config", timeout=5, verify=verify)
                    if cfg.status_code < 500:
                        os.environ["NIFI_API_BASE"] = base
                        os.environ["NIFI_BASE_URL"] = base
                        print(f"NiFi ready at {base}", flush=True)
                        return
            except Exception as exc:
                print(f"waiting for NiFi {base} ({attempt}): {exc}", flush=True)
        if time.time() >= deadline:
            print(
                "NiFi not ready — starting official MCP anyway so SSE is up",
                file=sys.stderr,
                flush=True,
            )
            return
        time.sleep(3)


def _patch_fastmcp_bind() -> None:
    try:
        from mcp.server.fastmcp import FastMCP
    except Exception as exc:
        print(f"warning: cannot patch FastMCP bind: {exc}", file=sys.stderr)
        return

    host = os.environ.get("MCP_HOST", "0.0.0.0")
    port = int(os.environ.get("MCP_PORT", "8000"))
    original = FastMCP.__init__

    def patched(self, *args, **kwargs):
        kwargs.setdefault("host", host)
        kwargs.setdefault("port", port)
        return original(self, *args, **kwargs)

    FastMCP.__init__ = patched  # type: ignore[method-assign]


def _patch_standalone_auth() -> None:
    """Official auth is Knox. Standalone NiFi 1.x/2.x uses /access/token."""
    user = os.environ.get("NIFI_USERNAME") or os.environ.get("KNOX_USER")
    password = os.environ.get("NIFI_PASSWORD") or os.environ.get("KNOX_PASSWORD")
    if not user or not password:
        return
    if os.environ.get("KNOX_TOKEN") or os.environ.get("KNOX_COOKIE"):
        return

    import requests
    from nifi_mcp_server import server as official
    from nifi_mcp_server.client import NiFiClient

    original = official.build_client

    def patched(config):
        base = config.build_nifi_base()
        verify = config.build_verify()
        session = requests.Session()
        session.verify = verify
        token_url = base.rstrip("/") + "/access/token"
        last_err = None
        for attempt in range(1, 13):
            try:
                resp = session.post(
                    token_url,
                    data={"username": user, "password": password},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=8,
                )
                if _token_ok(resp):
                    session.headers["Authorization"] = f"Bearer {resp.text.strip()}"
                    print(f"authenticated to {base} as {user} (NiFi single-user token)", flush=True)
                    return NiFiClient(
                        base,
                        session,
                        timeout_seconds=config.timeout_seconds,
                        proxy_context_path=config.proxy_context_path,
                    )
                print(
                    f"NiFi token auth failed ({resp.status_code}): {resp.text[:200]}",
                    file=sys.stderr,
                    flush=True,
                )
                return original(config)
            except Exception as exc:
                last_err = exc
                print(f"token attempt {attempt}/12 failed: {exc}", flush=True)
                time.sleep(5)
        print(f"giving up token auth after retries: {last_err}", file=sys.stderr, flush=True)
        return original(config)

    official.build_client = patched


def main() -> None:
    _map_compose_env()
    try:
        import nifi_mcp_server  # noqa: F401
    except Exception as exc:
        print(
            "FATAL: official Cloudera package nifi-mcp-server is not installed.\n"
            "Install: pip install 'nifi-mcp-server @ git+https://github.com/cloudera/nifi-mcp-server.git'\n"
            f"{exc}",
            file=sys.stderr,
        )
        sys.exit(1)

    _patch_fastmcp_bind()
    wait_for_nifi()
    try:
        _patch_standalone_auth()
    except Exception as exc:
        print(f"auth patch skipped: {exc}", file=sys.stderr, flush=True)

    transport = os.environ.get("MCP_TRANSPORT", "sse")
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    port = os.environ.get("MCP_PORT", "8000")
    print(
        f"starting official Cloudera nifi-mcp-server transport={transport} {host}:{port}",
        flush=True,
    )
    print(
        f"NIFI_API_BASE={os.environ.get('NIFI_API_BASE')} "
        f"NIFI_READONLY={os.environ.get('NIFI_READONLY')}",
        flush=True,
    )

    from nifi_mcp_server.server import main as official_main

    official_main()


if __name__ == "__main__":
    main()
