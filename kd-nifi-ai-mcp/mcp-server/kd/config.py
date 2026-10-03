"""Endpoint, TLS, and authentication configuration for KD components."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from .errors import ConfigurationError


def _env(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return default


def _bool(raw: str | None, default: bool = True) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class ComponentEndpoint:
    name: str
    host: str
    aci_port: int
    index_port: int | None = None
    service_port: int | None = None
    protocol: str = "http"
    username: str | None = None
    password: str | None = None
    aci_security: str | None = None
    verify_tls: bool = True
    timeout_seconds: float = 30.0
    enabled: bool = True

    @property
    def aci_base(self) -> str:
        return f"{self.protocol}://{self.host}:{self.aci_port}"

    @property
    def index_base(self) -> str | None:
        if self.index_port is None:
            return None
        return f"{self.protocol}://{self.host}:{self.index_port}"

    @property
    def service_base(self) -> str | None:
        if self.service_port is None:
            return None
        return f"{self.protocol}://{self.host}:{self.service_port}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "host": self.host,
            "aciPort": self.aci_port,
            "indexPort": self.index_port,
            "servicePort": self.service_port,
            "protocol": self.protocol,
            "aciBase": self.aci_base,
            "indexBase": self.index_base,
            "serviceBase": self.service_base,
            "hasUsername": bool(self.username),
            "hasPassword": bool(self.password),
            "hasAciSecurity": bool(self.aci_security),
            "verifyTls": self.verify_tls,
            "timeoutSeconds": self.timeout_seconds,
            "enabled": self.enabled,
        }


# Default ACI/index/service ports from OpenText Getting Started / Docker conventions.
# These are defaults only; production must override via environment.
DEFAULT_PORTS: dict[str, dict[str, int]] = {
    "Content": {"aci": 9100, "index": 9101, "service": 9102},
    "Community": {"aci": 9030, "service": 9032},
    "Category": {"aci": 9020, "service": 9022},
    "Agentstore": {"aci": 9050, "index": 9051, "service": 9052},
    "View": {"aci": 9080, "service": 9082},
    "QMS": {"aci": 16000, "service": 16002},
    "DAH": {"aci": 9060, "service": 9062},
    "DIH": {"aci": 9070, "index": 9071, "service": 9072},
    "MediaServer": {"aci": 14000, "service": 14002},
    "Eduction": {"aci": 13200, "service": 13202},
    "CFS": {"aci": 7000, "service": 7002},
    "LicenseServer": {"aci": 20000, "service": 20002},
    "Proxy": {"aci": 9000, "index": 9001, "service": 9002},
    "AnswerServer": {"aci": 8850, "service": 8852},
    "KnowledgeGraph": {"aci": 19800, "service": 19802},
    "OmniGroupServer": {"aci": 30570, "service": 30572},
    "Controller": {"aci": 46600, "service": 46602},
    "Coordinator": {"aci": 40200, "service": 40202},
}


ENV_PREFIX = {
    "Content": "KD_CONTENT",
    "Community": "KD_COMMUNITY",
    "Category": "KD_CATEGORY",
    "Agentstore": "KD_AGENTSTORE",
    "View": "KD_VIEW",
    "QMS": "KD_QMS",
    "DAH": "KD_DAH",
    "DIH": "KD_DIH",
    "MediaServer": "KD_MEDIA",
    "Eduction": "KD_EDUCTION",
    "CFS": "KD_CFS",
    "LicenseServer": "KD_LICENSE",
    "Proxy": "KD_PROXY",
    "AnswerServer": "KD_ANSWER",
    "KnowledgeGraph": "KD_KG",
    "OmniGroupServer": "KD_OGS",
    "Controller": "KD_CONTROLLER",
    "Coordinator": "KD_COORDINATOR",
}


@dataclass
class KdConfig:
    default_host: str = "127.0.0.1"
    protocol: str = "http"
    verify_tls: bool = True
    timeout_seconds: float = 30.0
    username: str | None = None
    password: str | None = None
    aci_security: str | None = None
    components: dict[str, ComponentEndpoint] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "KdConfig":
        default_host = _env("KD_HOST", "IDOL_HOST", default="127.0.0.1") or "127.0.0.1"
        protocol = (_env("KD_PROTOCOL", default="http") or "http").lower()
        verify_tls = _bool(_env("KD_VERIFY_TLS", "KD_VERIFY_SSL", "NIFI_VERIFY_SSL"), default=True)
        timeout_seconds = float(_env("KD_TIMEOUT_SECONDS", default="30") or "30")
        username = _env("KD_USERNAME", "IDOL_USERNAME")
        password = _env("KD_PASSWORD", "IDOL_PASSWORD")
        aci_security = _env("KD_SECURITY_INFO", "IDOL_SECURITY_INFO")
        cfg = cls(
            default_host=default_host,
            protocol=protocol,
            verify_tls=verify_tls,
            timeout_seconds=timeout_seconds,
            username=username,
            password=password,
            aci_security=aci_security,
        )
        for name, prefix in ENV_PREFIX.items():
            ports = DEFAULT_PORTS[name]
            host = _env(f"{prefix}_HOST", "KD_HOST", "IDOL_HOST", default=default_host) or default_host
            aci = int(_env(f"{prefix}_PORT", f"{prefix}_ACI_PORT", default=str(ports["aci"])) or ports["aci"])
            index = ports.get("index")
            if _env(f"{prefix}_INDEX_PORT"):
                index = int(_env(f"{prefix}_INDEX_PORT") or "0")
            service = ports.get("service")
            if _env(f"{prefix}_SERVICE_PORT"):
                service = int(_env(f"{prefix}_SERVICE_PORT") or "0")
            enabled_raw = _env(f"{prefix}_ENABLED")
            enabled = True if enabled_raw is None else _bool(enabled_raw)
            # Shared Content fallback used by existing .env.example (IDOL_HOST/IDOL_PORT).
            if name == "Content":
                host = _env("KD_CONTENT_HOST", "IDOL_HOST", "KD_HOST", default=host) or host
                aci = int(_env("KD_CONTENT_PORT", "IDOL_PORT", "KD_CONTENT_ACI_PORT", default=str(aci)) or aci)
            cfg.components[name] = ComponentEndpoint(
                name=name,
                host=host,
                aci_port=aci,
                index_port=index,
                service_port=service,
                protocol=(_env(f"{prefix}_PROTOCOL", default=protocol) or protocol).lower(),
                username=_env(f"{prefix}_USERNAME") or username,
                password=_env(f"{prefix}_PASSWORD") or password,
                aci_security=_env(f"{prefix}_SECURITY_INFO") or aci_security,
                verify_tls=_bool(_env(f"{prefix}_VERIFY_TLS"), default=verify_tls),
                timeout_seconds=float(_env(f"{prefix}_TIMEOUT", default=str(timeout_seconds)) or timeout_seconds),
                enabled=enabled,
            )
        return cfg

    def require(self, name: str) -> ComponentEndpoint:
        endpoint = self.components.get(name)
        if endpoint is None:
            raise ConfigurationError(f"Unknown component '{name}'")
        if not endpoint.enabled:
            raise ConfigurationError(f"Component '{name}' is disabled")
        if not endpoint.host:
            raise ConfigurationError(f"Component '{name}' has no host configured")
        return endpoint

    def as_dict(self) -> dict[str, Any]:
        return {
            "defaultHost": self.default_host,
            "protocol": self.protocol,
            "verifyTls": self.verify_tls,
            "timeoutSeconds": self.timeout_seconds,
            "hasUsername": bool(self.username),
            "hasAciSecurity": bool(self.aci_security),
            "components": {k: v.as_dict() for k, v in self.components.items()},
        }
