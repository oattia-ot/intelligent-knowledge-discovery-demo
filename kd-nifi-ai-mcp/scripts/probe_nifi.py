#!/usr/bin/env python3
"""Probe a live NiFi before deploying the NiFi AI stack.

Host-side check (not Docker DNS): login + GET /nifi-api/flow/about.
Also prints recommended compose settings when a NiFi container is found.

Exit 0 on success, 1 on failure.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SSL_CTX = ssl._create_unverified_context()

# Documented example IP from older .env.example files — not this machine.
STALE_EXAMPLE_HOSTS = {"172.25.125.123"}

# Never treat these host ports as NiFi. 5000 is Docker Registry / AirPlay /
# Flask and is what produced SSL RECORD_LAYER_FAILURE in the default probe.
BLOCKED_HOST_PORTS = {5000, 2375, 2376, 3306, 5432, 6379, 9042, 27017}

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "0.0.0.0", "host.docker.internal"}

# Typical published NiFi ports. Used when deploy=docker so we do not pick
# an unrelated published port (e.g. 5000) as NIFI_EXISTING_PORT.
NIFI_LIKE_PORTS = {8443, 8080, 8081, 9443, 18443, 8555, 443, 8444}


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        values[key.strip()] = val.strip()
    return values


def request(
    url: str,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 8.0,
) -> tuple[int, str]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
            body = resp.read(20000).decode("utf-8", "ignore")
            return int(getattr(resp, "status", 200)), body
    except urllib.error.HTTPError as e:
        try:
            body = e.read(20000).decode("utf-8", "ignore")
        except Exception:
            body = str(e)
        return int(e.code), body
    except Exception as e:
        return 0, str(e)


def normalize_api(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    path = parsed.path or ""
    if path.endswith("/nifi"):
        path = path[: -len("/nifi")] + "/nifi-api"
    elif "/nifi-api" not in path:
        path = path.rstrip("/") + "/nifi-api"
    return urllib.parse.urlunparse(parsed._replace(path=path, query="", fragment=""))


def host_of(url: str) -> str:
    try:
        return (urllib.parse.urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def is_stale_example(url_or_host: str) -> bool:
    raw = (url_or_host or "").strip().lower()
    if raw in STALE_EXAMPLE_HOSTS:
        return True
    return host_of(raw if "://" in raw else "https://" + raw) in STALE_EXAMPLE_HOSTS


def port_of(url: str) -> int | None:
    try:
        parsed = urllib.parse.urlparse(url if "://" in url else "https://" + url)
        if parsed.port:
            return int(parsed.port)
        if parsed.scheme == "https":
            return 443
        if parsed.scheme == "http":
            return 80
    except Exception:
        return None
    return None


def is_blocked_url(url: str) -> bool:
    port = port_of(url)
    return port is not None and port in BLOCKED_HOST_PORTS


def is_docker_only_hostname(url_or_host: str) -> bool:
    """Hostnames like nifi-manager only resolve on a Docker network."""
    host = host_of(url_or_host if "://" in (url_or_host or "") else "https://" + (url_or_host or ""))
    if not host or host in LOCAL_HOSTS or host in STALE_EXAMPLE_HOSTS:
        return False
    if any(ch.isdigit() for ch in host) and host.replace(".", "").isdigit():
        return False
    if "." in host:
        return False
    return True


def login_and_about(api_base: str, username: str, password: str) -> dict[str, Any]:
    api = normalize_api(api_base)
    token_url = api + "/access/token"
    about_url = api + "/flow/about"
    status, body = request(
        token_url,
        method="POST",
        data=urllib.parse.urlencode({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if status == 0:
        return {"ok": False, "api": api, "error": f"connection failed: {body}"}
    if "invalid sni" in body.lower() or "sni" in body.lower() and status == 400:
        return {
            "ok": False,
            "api": api,
            "error": f"token HTTP {status} Invalid SNI — do not call NiFi HTTPS with host.docker.internal; use the container name on idol-demo-network or http://nifi-proxy:8080",
        }
    if status not in (200, 201) or not body.strip() or "<html" in body.lower():
        return {"ok": False, "api": api, "error": f"login failed HTTP {status}: {body[:240]}"}
    token = body.strip()
    status, about = request(
        about_url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    if status != 200:
        return {"ok": False, "api": api, "error": f"GET /flow/about HTTP {status}: {about[:240]}"}
    try:
        payload = json.loads(about)
    except json.JSONDecodeError:
        return {"ok": False, "api": api, "error": f"GET /flow/about not JSON: {about[:240]}"}
    about_obj = payload.get("about") if isinstance(payload, dict) else None
    version = ""
    if isinstance(about_obj, dict):
        version = str(about_obj.get("version") or about_obj.get("title") or "")
    elif isinstance(payload, dict):
        version = str(payload.get("version") or "")
    return {"ok": True, "api": api, "version": version or "unknown", "about": payload}


def docker_nifi_rows() -> list[dict[str, Any]]:
    try:
        import subprocess

        proc = subprocess.run(
            [
                "docker",
                "ps",
                "--format",
                "{{.ID}}\t{{.Names}}\t{{.Ports}}\t{{.Label \"com.docker.compose.service\"}}",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
    except Exception:
        return []
    if proc.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in proc.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        name = parts[1]
        ports = parts[2]
        service = parts[3] if len(parts) > 3 else ""
        if "nifi" not in name.lower() and service.lower() != "nifi":
            continue
        if "nifi-proxy" in name.lower() or "nifi-ai" in name.lower() or "nifi-kd" in name.lower():
            continue
        published = []
        for chunk in ports.split(","):
            chunk = chunk.strip()
            if "->" not in chunk:
                continue
            left, right = chunk.split("->", 1)
            host = left.rsplit(":", 1)[-1]
            cont = right.split("/")[0]
            if host.isdigit() and cont.isdigit():
                published.append((int(host), int(cont)))
        networks: list[str] = []
        try:
            raw = subprocess.run(
                ["docker", "inspect", parts[0]], capture_output=True, text=True, timeout=8
            ).stdout
            info = json.loads(raw)[0]
            networks = list(((info.get("NetworkSettings") or {}).get("Networks") or {}).keys())
        except Exception:
            pass
        host_port = next((hp for hp, cp in published if cp == 8443), None)
        if host_port is None:
            host_port = next((hp for hp, cp in published if cp in (8080, 8081, 9443)), None)
        if host_port is not None and host_port in BLOCKED_HOST_PORTS:
            host_port = None
        usable = [
            (hp, cp)
            for hp, cp in published
            if hp not in BLOCKED_HOST_PORTS and (cp in NIFI_LIKE_PORTS or hp in NIFI_LIKE_PORTS)
        ]
        rows.append(
            {
                "name": name,
                "service": service,
                "host_port": host_port if host_port not in BLOCKED_HOST_PORTS else None,
                "published": published,
                "usable_published": usable,
                "networks": networks,
            }
        )
    rows.sort(key=lambda r: (0 if "idol" in r["name"].lower() else 1, r["name"]))
    return rows


def recommend_from_docker(row: dict[str, Any]) -> dict[str, str]:
    name = row["name"]
    nets = row.get("networks") or []
    preferred_nets = ("idol-demo-network",)
    net = next((n for n in preferred_nets if n in nets), None) or (nets[0] if nets else "kd-nifi-ext")
    internal_port = 8443
    published = row.get("published") or []
    for _hp, cp in published:
        if cp in (8443, 8080, 8081, 9443):
            internal_port = cp
            break
    scheme = "http" if internal_port in (8080, 8081) else "https"
    return {
        "NIFI_UPSTREAM": f"{name}:{internal_port}",
        "NIFI_API_BASE": f"{scheme}://{name}:{internal_port}/nifi-api",
        "NIFI_BASE_URL": f"{scheme}://{name}:{internal_port}/nifi-api",
        "NIFI_EXTERNAL_URL": f"{scheme}://{name}:{internal_port}",
        "NIFI_EXTERNAL_API": f"{scheme}://{name}:{internal_port}/nifi-api",
        "NIFI_API_BASES": f"{scheme}://{name}:{internal_port}/nifi-api,http://nifi-proxy:8080/nifi-api",
        "NIFI_DOCKER_NETWORK": net,
        "NIFI_DOCKER_NETWORK_EXTERNAL": "true" if net != "kd-nifi-ext" else "false",
        "NIFI_EXISTING_NAME": name,
        "NIFI_VERIFY_SSL": "false",
        "NIFI_DEPLOY": "docker",
    }


def candidate_urls(
    cli_url: str | None,
    env: dict[str, str],
    deploy: str = "auto",
    include_docker_dns: bool = False,
) -> list[str]:
    found: list[str] = []

    def add(url: str) -> None:
        url = (url or "").strip()
        if not url:
            return
        if is_stale_example(url):
            return
        if is_blocked_url(url):
            return
        if not include_docker_dns and is_docker_only_hostname(url):
            return
        api = normalize_api(url)
        if not api or is_blocked_url(api):
            return
        if api not in found:
            found.append(api)

    add(cli_url or "")
    add(env.get("NIFI_EXTERNAL_URL", ""))
    add(env.get("NIFI_API_BASE", ""))
    extra_host = (
        os.environ.get("EXTRA_IP_SANS_ENV")
        or os.environ.get("IDOL_NET_HOST_IP")
        or os.environ.get("FTA_UPSTREAM_HOST")
        or ""
    ).split(",")[0].strip()
    if extra_host and extra_host not in LOCAL_HOSTS:
        extra_host = extra_host.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
        add(f"https://{extra_host}:8443")
        add(f"https://{extra_host}:9443")
        add(f"http://{extra_host}:8080")

    if deploy in {"linux", "windows"}:
        add("https://127.0.0.1:8443")
        add("http://127.0.0.1:8080")
        add("https://127.0.0.1:9443")
        return found

    host_port = env.get("NIFI_EXISTING_PORT") or env.get("NIFI_TLS_HOST_PORT") or ""
    if host_port.isdigit() and int(host_port) not in BLOCKED_HOST_PORTS:
        add(f"https://127.0.0.1:{host_port}")
        add(f"http://127.0.0.1:{host_port}")
    add("https://127.0.0.1:8443")
    add("http://127.0.0.1:8080")
    for row in docker_nifi_rows():
        for hp, cp in row.get("usable_published") or []:
            scheme = "http" if cp in (8080, 8081) else "https"
            add(f"{scheme}://127.0.0.1:{hp}")
        hp = row.get("host_port")
        if hp and hp not in BLOCKED_HOST_PORTS:
            add(f"https://127.0.0.1:{hp}")
    return found


def health_check_api(api_base: str) -> dict[str, Any]:
    """GET /access/config — no credentials. Used for Linux/Windows URL checks."""
    api = normalize_api(api_base)
    if is_blocked_url(api):
        return {"ok": False, "api": api, "error": f"blocked port (not NiFi): {api}"}
    status, body = request(api + "/access/config")
    if status == 0:
        return {"ok": False, "api": api, "error": f"connection failed: {body}"}
    if status >= 500:
        return {"ok": False, "api": api, "error": f"GET /access/config HTTP {status}: {body[:240]}"}
    blob = body.lower()
    looks_nifi = (
        "supportslogin" in blob
        or "supportsanonymous" in blob
        or "\"config\"" in blob
        or status in (200, 401, 403, 409)
    )
    if not looks_nifi and "nifi" not in blob:
        return {"ok": False, "api": api, "error": f"not a NiFi API (HTTP {status})"}
    return {"ok": True, "api": api, "status": status, "body": body[:400]}


def probe(
    urls: list[str],
    username: str,
    password: str,
    wait: int,
    health_only: bool = False,
) -> dict[str, Any]:
    deadline = time.time() + max(0, wait)
    last: dict[str, Any] = {"ok": False, "error": "no URLs to try", "tried": []}
    while True:
        tried: list[str] = []
        for api in urls:
            health = health_check_api(api)
            if not health.get("ok"):
                stamp = f"{health.get('api')} -> health {health.get('error')}"
                tried.append(stamp)
                last = health
                continue
            if health_only:
                health["tried"] = tried + [f"{health.get('api')} -> health ok"]
                return health
            result = login_and_about(api, username, password)
            stamp = f"{result.get('api')} -> {result.get('error') or 'ok version=' + str(result.get('version'))}"
            tried.append(stamp)
            if result.get("ok"):
                result["tried"] = tried
                return result
            last = result
        last["tried"] = tried
        if time.time() >= deadline:
            return last
        time.sleep(3)


def docker_internal_health(row: dict[str, Any], username: str, password: str) -> dict[str, Any]:
    """Login from a throwaway container on the NiFi Docker network."""
    import subprocess

    rec = recommend_from_docker(row)
    api = rec["NIFI_API_BASE"]
    net = rec["NIFI_DOCKER_NETWORK"]
    if not net or net == "kd-nifi-ext":
        return {"ok": False, "error": "no docker network to join", "api": api}
    script = (
        "import ssl,urllib.parse,urllib.request,sys;"
        "ctx=ssl._create_unverified_context();"
        f"api={api!r};"
        f"user={username!r};"
        f"pw={password!r};"
        "data=urllib.parse.urlencode({'username':user,'password':pw}).encode();"
        "req=urllib.request.Request(api+'/access/token',data=data,method='POST',"
        "headers={'Content-Type':'application/x-www-form-urlencoded'});"
        "\ntry:\n"
        " r=urllib.request.urlopen(req,timeout=8,context=ctx);"
        " body=r.read(200).decode('utf-8','ignore');"
        " print('OK',r.status,body[:40]);"
        " sys.exit(0)\n"
        "except Exception as e:\n"
        " print('FAIL',e); sys.exit(1)"
    )
    try:
        proc = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                net,
                "python:3.12-slim",
                "python",
                "-c",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception as exc:
        return {"ok": False, "api": api, "network": net, "error": str(exc)}
    ok = proc.returncode == 0 and "OK" in (proc.stdout or "")
    return {
        "ok": ok,
        "api": api,
        "network": net,
        "error": None if ok else (proc.stdout + proc.stderr)[:400],
        "recommend": rec,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Test NiFi login + /flow/about before deploying NiFi AI")
    parser.add_argument("--env", default=".env", help="Path to kd-nifi-ai-mcp/.env")
    parser.add_argument("--url", default=None, help="NiFi UI or API URL to try first")
    parser.add_argument("--nifi-user", default=None)
    parser.add_argument("--nifi-password", default=None)
    parser.add_argument("--wait", type=int, default=0, help="Retry this many seconds (local NiFi boot)")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--recommend", action="store_true", help="Print recommended .env keys for a Docker NiFi")
    parser.add_argument(
        "--deploy",
        choices=("auto", "linux", "windows", "docker"),
        default=None,
        help="Where NiFi runs: linux/windows = health-check host URL; docker = join container network",
    )
    parser.add_argument(
        "--health-only",
        action="store_true",
        help="Only GET /nifi-api/access/config (Linux/Windows URL check)",
    )
    args = parser.parse_args()

    env_path = Path(args.env)
    env = parse_env(env_path)
    deploy = (args.deploy or env.get("NIFI_DEPLOY") or "auto").strip().lower()
    user = args.nifi_user or env.get("NIFI_USERNAME") or os.environ.get("NIFI_USERNAME") or "admin"
    password = args.nifi_password or env.get("NIFI_PASSWORD") or os.environ.get("NIFI_PASSWORD") or ""
    if not password and not args.health_only:
        print("NIFI_PASSWORD is empty — set it in .env or pass --nifi-password", file=sys.stderr)
        return 1

    if args.url and is_stale_example(args.url):
        print(
            f"Refusing stale example host in {args.url}. "
            "Use https://127.0.0.1:8443 or the running container published port.",
            file=sys.stderr,
        )
        args.url = None
    if args.url and is_blocked_url(args.url):
        print(f"Refusing blocked port in {args.url} (not a NiFi listener).", file=sys.stderr)
        args.url = None

    urls = candidate_urls(args.url, env, deploy=deploy)
    rows = docker_nifi_rows() if deploy in {"auto", "docker"} else []
    rec = recommend_from_docker(rows[0]) if rows else {}

    print(f"NiFi deploy mode: {deploy}")
    if deploy in {"linux", "windows"}:
        print("Health-checking the NiFi API URL on the host (no Docker DNS names).")
    if deploy == "docker" and rows:
        print(f"Docker NiFi: {rows[0]['name']}")
        print(f"  networks: {', '.join(rows[0].get('networks') or []) or '(none)'}")
        print(f"  join as external compose network: {rec.get('NIFI_DOCKER_NETWORK')}")
        print(f"  container API: {rec.get('NIFI_API_BASE')}")

    if args.recommend and rec:
        print("# Recommended settings for the discovered Docker NiFi")
        for key, val in rec.items():
            print(f"{key}={val}")

    if not urls:
        print("No reachable NiFi URL candidates (and example IPs were skipped).", file=sys.stderr)
        if rows:
            print(f"Docker NiFi found: {rows[0]['name']} on networks {rows[0].get('networks')}", file=sys.stderr)
        return 1

    print(f"Probing NiFi as {user} …")
    for u in urls:
        print(f"  candidate {u}")

    result = probe(urls, user, password, args.wait, health_only=args.health_only)
    if args.json:
        print(json.dumps({**result, "recommend": rec, "deploy": deploy}, indent=2, default=str))
    elif result.get("ok"):
        extra = result.get("version") or f"health HTTP {result.get('status', 'ok')}"
        print(f"OK  {result['api']}  {extra}")
        if rec and deploy == "docker":
            print(f"Docker target: {rec.get('NIFI_EXISTING_NAME')} on {rec.get('NIFI_DOCKER_NETWORK')}")
            print(f"Set NIFI_UPSTREAM={rec.get('NIFI_UPSTREAM')}")
    else:
        print("FAILED to reach a working NiFi API", file=sys.stderr)
        for line in result.get("tried") or [result.get("error")]:
            print(f"  {line}", file=sys.stderr)
        if deploy in {"linux", "windows"}:
            print(
                "Pass a reachable --nifi-url (https://HOST:PORT or http://HOST:PORT) "
                "that serves /nifi-api/access/config.",
                file=sys.stderr,
            )
        else:
            print(
                "Fix the published NiFi URL / credentials, or join the container "
                "network listed above after deploy.",
                file=sys.stderr,
            )
        if rec.get("NIFI_DOCKER_NETWORK"):
            print(
                f"Compose can still join {rec['NIFI_DOCKER_NETWORK']} as NIFI_DOCKER_NETWORK "
                f"and call {rec.get('NIFI_API_BASE')}.",
                file=sys.stderr,
            )
            return 2
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
