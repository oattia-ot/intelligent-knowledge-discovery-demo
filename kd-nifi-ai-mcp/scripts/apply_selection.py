#!/usr/bin/env python3
"""Rewrite .env so this run's local/remote + linux/windows/docker choice wins.

Leftover keys from a previous remote session (idol-demo-network) must not
leak into a local deploy — Compose cannot relabel that network as nifi-ext.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urlparse


def parse_env(path: Path) -> list[str]:
    if not path.exists():
        return []
    return path.read_text(encoding="utf-8").splitlines()


def upsert(lines: list[str], updates: dict[str, str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in lines:
        if not raw.strip() or raw.strip().startswith("#") or "=" not in raw:
            out.append(raw)
            continue
        key = raw.split("=", 1)[0].strip()
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(raw)
    for key, val in updates.items():
        if key not in seen:
            out.append(f"{key}={val}")
    return out


def host_port_from_url(url: str) -> tuple[str, int, str]:
    raw = (url or "").strip()
    if raw and "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw or "https://127.0.0.1:8443")
    host = parsed.hostname or "127.0.0.1"
    scheme = parsed.scheme or "https"
    port = parsed.port or (443 if scheme == "https" else 80)
    return host, port, scheme


def updates_for(
    location: str,
    deploy: str,
    image: str,
    nifi_url: str,
    existing: dict[str, str],
) -> dict[str, str]:
    location = (location or "remote").lower()
    deploy = (deploy or "docker").lower()
    out: dict[str, str] = {
        "NIFI_LOCATION": location,
        "NIFI_DEPLOY": deploy if location == "remote" else "docker",
        "NIFI_HOST_PORT": existing.get("NIFI_HOST_PORT") or "27111",
        "NIFI_TLS_HOST_PORT": existing.get("NIFI_TLS_HOST_PORT") or "27113",
        "NIFI_PROXY_HOST_PORT": existing.get("NIFI_PROXY_HOST_PORT") or "27111",
        "MCP_HOST_PORT": existing.get("MCP_HOST_PORT") or "27115",
        "ORCHESTRATOR_HOST_PORT": existing.get("ORCHESTRATOR_HOST_PORT") or "27110",
        "UI_HOST_PORT": existing.get("UI_HOST_PORT") or "27120",
        "NIFI_VERIFY_SSL": existing.get("NIFI_VERIFY_SSL") or "false",
    }

    if location == "local":
        img = image or "microfocusidolserver/nifi-ver2-full:26.3"
        out.update(
            {
                "NIFI_IMAGE": img,
                "START_NIFI": "true",
                "NIFI_SOURCE": "new",
                "NIFI_EXISTING_NAME": "nifi",
                "NIFI_UPSTREAM": "nifi:8443",
                "NIFI_API_BASE": "https://nifi:8443/nifi-api",
                "NIFI_BASE_URL": "https://nifi:8443/nifi-api",
                "NIFI_EXTERNAL_URL": "https://127.0.0.1:27113",
                "NIFI_EXTERNAL_API": "https://127.0.0.1:27113/nifi-api",
                "NIFI_API_BASES": "https://nifi:8443/nifi-api,http://nifi-proxy:8080/nifi-api",
                "NIFI_DOCKER_NETWORK": "kd-nifi-ext",
                "NIFI_DOCKER_NETWORK_EXTERNAL": "false",
                "COMPOSE_PROFILES": _profiles(existing.get("COMPOSE_PROFILES", ""), add="create-nifi"),
            }
        )
        return out

    # remote
    out["START_NIFI"] = "false"
    out["NIFI_IMAGE"] = image or existing.get("NIFI_IMAGE") or ""
    out["COMPOSE_PROFILES"] = _profiles(existing.get("COMPOSE_PROFILES", ""), drop="create-nifi")

    if deploy in {"linux", "windows"}:
        host, port, scheme = host_port_from_url(
            nifi_url or existing.get("NIFI_EXTERNAL_URL") or "https://127.0.0.1:8443"
        )
        loopback = host in {"127.0.0.1", "localhost", "::1"}
        upstream_host = "host.docker.internal" if loopback else host
        api = f"{scheme}://{host}:{port}/nifi-api"
        out.update(
            {
                "NIFI_UPSTREAM": f"{upstream_host}:{port}",
                "NIFI_API_BASE": api,
                "NIFI_BASE_URL": api,
                "NIFI_EXTERNAL_URL": f"{scheme}://{host}:{port}",
                "NIFI_EXTERNAL_API": api,
                "NIFI_API_BASES": f"{api},http://nifi-proxy:8080/nifi-api",
                "NIFI_DOCKER_NETWORK": "kd-nifi-ext",
                "NIFI_DOCKER_NETWORK_EXTERNAL": "false",
                "NIFI_EXISTING_PORT": str(port),
            }
        )
        return out

    # remote docker: keep allocator discovery when present, but never leave
    # EXTERNAL=false on a foreign network name.
    net = existing.get("NIFI_DOCKER_NETWORK") or "idol-demo-network"
    name = existing.get("NIFI_EXISTING_NAME") or "idol-nifi"
    if name in {"nifi-manager", "nifi"}:
        name = "idol-nifi"
    if net in {"kd-nifi-ext", ""}:
        net = "idol-demo-network"
        external = "true"
    else:
        external = "true"
    direct = existing.get("NIFI_EXTERNAL_API") or f"https://{name}:8443/nifi-api"
    proxy = "http://nifi-proxy:8080/nifi-api"
    # Proxy first: direct https://<container>:8443 sends SNI=<container> and
    # IDOL NiFi answers HTTP 400 Invalid SNI. Proxy forces SNI localhost.
    api = existing.get("NIFI_API_BASE") or proxy
    if "nifi:8443" in (api or "") or "nifi-manager" in (api or ""):
        api = proxy
    upstream = existing.get("NIFI_UPSTREAM") or f"{name}:8443"
    if "nifi-manager" in upstream or upstream in {"nifi:8443", "nifi:8443/nifi"}:
        upstream = "idol-nifi:8443"
        name = "idol-nifi"
    bases = existing.get("NIFI_API_BASES") or f"{proxy},{direct}"
    if "nifi:8443" in bases or "nifi-manager" in bases:
        bases = f"{proxy},https://idol-nifi:8443/nifi-api"
    out.update(
        {
            "NIFI_DOCKER_NETWORK": net,
            "NIFI_DOCKER_NETWORK_EXTERNAL": external,
            "NIFI_UPSTREAM": upstream,
            "NIFI_TLS_SERVER_NAME": existing.get("NIFI_TLS_SERVER_NAME") or "localhost",
            "NIFI_UI_REDIRECT_PORT": existing.get("NIFI_UI_REDIRECT_PORT")
            or existing.get("NIFI_EXISTING_PORT")
            or "8443",
            "NIFI_API_BASE": api if api.startswith("http://nifi-proxy") else proxy,
            "NIFI_BASE_URL": proxy,
            "NIFI_API_BASES": bases,
        }
    )
    return out


def _profiles(raw: str, add: str = "", drop: str = "") -> str:
    parts = [p.strip() for p in (raw or "").split(",") if p.strip()]
    if drop:
        parts = [p for p in parts if p != drop]
    if add and add not in parts:
        parts.append(add)
    return ",".join(parts)


def env_map(lines: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
    return values


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=".env")
    parser.add_argument("--location", required=True, choices=("local", "remote"))
    parser.add_argument("--deploy", default="docker", choices=("auto", "linux", "windows", "docker"))
    parser.add_argument("--image", default="")
    parser.add_argument("--nifi-url", default="")
    args = parser.parse_args()

    path = Path(args.env)
    lines = parse_env(path)
    existing = env_map(lines)
    updates = updates_for(args.location, args.deploy, args.image, args.nifi_url, existing)
    path.write_text("\n".join(upsert(lines, updates)).rstrip() + "\n", encoding="utf-8")
    print("Applied selection to .env:")
    for key in (
        "NIFI_LOCATION",
        "NIFI_DEPLOY",
        "NIFI_IMAGE",
        "START_NIFI",
        "NIFI_UPSTREAM",
        "NIFI_API_BASE",
        "NIFI_DOCKER_NETWORK",
        "NIFI_DOCKER_NETWORK_EXTERNAL",
        "COMPOSE_PROFILES",
    ):
        if key in updates:
            print(f"  {key}={updates[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
