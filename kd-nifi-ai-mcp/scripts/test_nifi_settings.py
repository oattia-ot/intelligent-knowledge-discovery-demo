#!/usr/bin/env python3
"""Offline checks for NiFi settings helpers (no live NiFi required)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import probe_nifi  # noqa: E402


def assert_eq(got, expect, label: str) -> None:
    if got != expect:
        raise SystemExit(f"FAIL {label}: got {got!r} expected {expect!r}")
    print(f"ok  {label}")


def main() -> int:
    assert_eq(
        probe_nifi.normalize_api("https://idol-demo-idol-nifi-1:8443"),
        "https://idol-demo-idol-nifi-1:8443/nifi-api",
        "normalize container UI URL",
    )
    assert_eq(
        probe_nifi.normalize_api("https://127.0.0.1:8443/nifi"),
        "https://127.0.0.1:8443/nifi-api",
        "normalize /nifi path",
    )
    assert_eq(probe_nifi.is_stale_example("172.25.125.123"), True, "stale host")
    assert_eq(
        probe_nifi.is_stale_example("https://172.25.125.123:8443/nifi-api"),
        True,
        "stale URL",
    )
    assert_eq(probe_nifi.is_stale_example("https://127.0.0.1:8443"), False, "localhost ok")
    assert_eq(
        probe_nifi.is_stale_example("https://idol-demo-idol-nifi-1:8443"),
        False,
        "container name ok",
    )

    rec = probe_nifi.recommend_from_docker(
        {
            "name": "idol-demo-idol-nifi-1",
            "host_port": 8443,
            "networks": ["idol-demo-network"],
        }
    )
    assert_eq(rec["NIFI_UPSTREAM"], "idol-demo-idol-nifi-1:8443", "upstream container")
    assert_eq(rec["NIFI_DOCKER_NETWORK"], "idol-demo-network", "join IDOL network")
    assert_eq(rec["NIFI_DOCKER_NETWORK_EXTERNAL"], "true", "external network flag")
    assert_eq("host.docker.internal" in rec["NIFI_API_BASES"], False, "no SNI hostname")
    assert_eq("172.25.125.123" in rec["NIFI_API_BASES"], False, "no stale IP")

    env = {
        "NIFI_EXTERNAL_URL": "https://172.25.125.123:8443",
        "NIFI_API_BASE": "https://172.25.125.123:8443/nifi-api",
        "NIFI_TLS_HOST_PORT": "8443",
    }
    urls = probe_nifi.candidate_urls(None, env)
    assert_eq(any("172.25.125.123" in u for u in urls), False, "candidates drop stale IP")
    assert_eq(any("127.0.0.1:8443" in u for u in urls), True, "candidates include localhost")

    blocked = probe_nifi.candidate_urls(
        "https://127.0.0.1:5000/nifi-api",
        {
            "NIFI_EXISTING_PORT": "5000",
            "NIFI_TLS_HOST_PORT": "5000",
            "NIFI_API_BASE": "https://nifi-manager:8443/nifi-api",
        },
        deploy="auto",
    )
    assert_eq(any(":5000" in u for u in blocked), False, "candidates drop port 5000")
    assert_eq(any("nifi-manager" in u for u in blocked), False, "host probe drops docker DNS")

    linux_urls = probe_nifi.candidate_urls(
        "https://192.168.10.20:8443",
        {"NIFI_API_BASE": "https://nifi-manager:8443/nifi-api"},
        deploy="linux",
    )
    assert_eq(any("192.168.10.20:8443" in u for u in linux_urls), True, "linux keeps host URL")
    assert_eq(any("nifi-manager" in u for u in linux_urls), False, "linux drops docker DNS")

    assert_eq(probe_nifi.is_blocked_url("https://127.0.0.1:5000/nifi-api"), True, "5000 blocked")
    assert_eq(probe_nifi.is_docker_only_hostname("https://nifi-manager:8443"), True, "nifi-manager is docker DNS")
    assert_eq(probe_nifi.is_docker_only_hostname("https://127.0.0.1:8443"), False, "loopback not docker DNS")

    print("all nifi settings tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
