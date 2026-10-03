"""Route imported catalog prompts to a real runner before the loose keyword matcher."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

import httpx

from kd_mcp_tools import call_kd_tool
from nifi_rest import NiFiRest


def _host(name: str, default_port: str) -> str:
    host = os.environ.get(f"{name}_HOST", os.environ.get("IDOL_HOST", "idol-content"))
    port = os.environ.get(f"{name}_PORT", default_port)
    return f"http://{host}:{port}"


def _content() -> str:
    return f"http://{os.environ.get('IDOL_HOST', 'idol-content')}:{os.environ.get('IDOL_PORT', '9100')}"


def _answer() -> str:
    return os.environ.get("ANSWER_SERVER_URL", "http://answerserver:12000").rstrip("/")


async def _aci(base: str, action: str, **params: Any) -> dict:
    query = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    url = f"{base}/action={action}" + (f"&{query}" if query else "")
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.get(url)
    text = resp.text[:4000]
    try:
        body: Any = resp.json()
    except Exception:
        body = {"raw": text}
    if resp.status_code >= 400:
        raise RuntimeError(f"{action} {resp.status_code} from {url}: {text[:300]}")
    return {"url": url, "status": resp.status_code, "body": body}


async def route(message: str) -> dict | None:
    text = " ".join(message.split())
    low = text.lower()

    if "list all process groups" in low or "process groups on the nifi canvas" in low:
        info = await NiFiRest().inspect_root()
        return {"reply": f"Root group '{info.get('name') or 'root'}' id={info.get('id')} on {info.get('baseUrl')}.", "data": info}

    if "content query" in low or "action=query" in low or low.startswith("search idol content"):
        data = await _aci(_content(), "Query", Text=_after(text, "for") or text, MaxResults="10", ResponseFormat="json")
        return {"reply": f"Content Query called {data['url']}.", "data": data}

    if "getcontent" in low:
        data = await _aci(_content(), "GetContent", ID=_after(text, "id") or "", ResponseFormat="json")
        return {"reply": f"GetContent called {data['url']}.", "data": data}

    if "suggest" in low and ("similar" in low or "content suggest" in low):
        data = await _aci(_content(), "Suggest", ID=_after(text, "id") or "", ResponseFormat="json")
        return {"reply": f"Content Suggest called {data['url']}.", "data": data}

    if "educefromtext" in low or "eduction" in low:
        data = await _aci(_host("EDUCTION", "13200"), "EduceFromText", Text=text, ResponseFormat="json")
        return {"reply": f"Eduction called {data['url']}.", "data": data}

    if "media server" in low or "speech-to-text" in low or "speech to text" in low:
        data = await _aci(_host("MEDIA", "14000"), "GetStatus", ResponseFormat="json")
        return {
            "reply": f"Media Server status from {data['url']}. Process/OCR/speech still need a file on the Media Server host; this click checks the engine.",
            "data": data,
        }

    if "answer server" in low or low.startswith("ask answer"):
        data = await _aci(_answer(), "Ask", Text=text, SystemName=os.environ.get("ANSWER_SYSTEM_NAME", "MyAnswerSystem"), ResponseFormat="json")
        return {"reply": f"Answer Server Ask called {data['url']}.", "data": data}

    if "knowledge graph" in low or "getneighbors" in low:
        data = await _aci(_host("KG", "16050"), "GetNeighbors", NodeID=_after(text, "node") or "", ResponseFormat="json")
        return {"reply": f"Knowledge Graph called {data['url']}.", "data": data}

    if "cfs connector" in low or "cfs connector status" in low:
        data = await _aci(_host("CFS", "7000"), "GetStatus", ResponseFormat="json")
        return {"reply": f"CFS GetStatus called {data['url']}.", "data": data}

    if "license server" in low or "licenseget" in low:
        data = await _aci(_host("LICENSE", "20000"), "GetStatus", ResponseFormat="json")
        return {"reply": f"License Server GetStatus called {data['url']}.", "data": data}

    if "resolve idol" in low and "nar" in low:
        data = await call_kd_tool("resolve_idol_nars", {})
        return {"reply": "Resolved IDOL NiFi NARs from the compatibility matrix.", "data": data}

    if "generate a 26.3" in low or "keyviewfilter then putidol" in low:
        data = await call_kd_tool("generate_idol_nifi_flow", {"prompt": text})
        return {"reply": "Generated a version-aware IDOL flow spec. It was not deployed.", "plan": data, "data": data}

    if "getfile flow that tails" in low or low.startswith("build a getfile"):
        data = await call_kd_tool("create_kd_file_connector_flow", {"flow_name": "file-ingest", "source_path": "/data/incoming"})
        return {"reply": f"Created file ingest group '{data.get('name')}'.", "data": data}

    if "indexing and enrichment" in low:
        data = await call_kd_tool("create_kd_enrichment_flow", {})
        return {"reply": f"Created enrichment stage '{data.get('name')}'.", "data": data}

    if "discover configured knowledge discovery" in low or "service discovery" in low:
        data = await _aci(_content(), "GetStatus", ResponseFormat="json")
        return {"reply": f"Content GetStatus called {data['url']}.", "data": data}

    if "which knowledge discovery" in low and "api" in low:
        return {
            "reply": "Use Content Query for search, GetContent for a document, Answer Server Ask for a question, and create_kd_* only for a flow build.",
            "data": {"routed": True},
        }
    return None


def _after(text: str, marker: str) -> str:
    low = text.lower()
    at = low.rfind(marker)
    if at < 0:
        return ""
    return text[at + len(marker):].strip(" :")
