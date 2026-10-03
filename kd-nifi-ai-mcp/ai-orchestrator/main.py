"""Orchestrator: chat UI ↔ official NiFi MCP server + Ollama."""

from __future__ import annotations

import json
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from mcp_client import MCPSession, flatten_exc
from nifi_rest import NiFiRest
from ollama_client import OllamaClient, OllamaError
from kd_mcp_tools import call_kd_tool, kd_tool_catalog, kd_tool_names
from gateway_guard import require_gateway
from catalog_router import route as route_catalog
from template_catalog import (
    clear_custom_objects,
    delete_custom_object,
    find_object,
    list_lookup_kind,
    list_lookup_objects,
    list_lookup_templates,
    persist_custom_object,
    persist_custom_template,
)


def _nar_banner(data: dict) -> str:
    lines = [
        f"IDOL: {data.get('idolVersion') or 'unspecified'}",
        f"NiFi: {data.get('nifiVersion') or 'unspecified'}",
        f"NAR profile: {data.get('narProfile') or 'none'}",
        f"NAR validation: {data.get('narValidation') or data.get('status')}",
        "Required NARs: " + ", ".join(data.get("requiredNars") or []) or "(none)",
        f"Deployment: {data.get('deployment') or 'EXTERNAL'}",
        f"Flow: {data.get('flow') or data.get('status')}",
    ]
    if data.get("reason"):
        lines.append(f"Reason: {data.get('reason')}")
    if data.get("requiredAction"):
        lines.append(f"Required action: {data.get('requiredAction')}")
    return "\n".join(lines)

app = FastAPI(title="KD NiFi AI Orchestrator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

mcp_session = MCPSession()
ollama = OllamaClient()

SYSTEM = """You are a NiFi flow assistant. You talk to Apache NiFi through
the official Cloudera NiFi MCP tools when they are available.
Never invent a NiFi version, process group id, or connection status.
If a tool result is missing, say you could not reach NiFi.
Follow NiFi best practices:
- create a process group for each flow
- name processors clearly
- wire only the relationships you intend
- validate before starting
- never start a flow unless the user asked to run it
Keep replies short. When you create something, list the ids."""


class ChatRequest(BaseModel):
    message: str
    sessionId: str | None = None


class ChatResponse(BaseModel):
    reply: str
    plan_id: str | None = None
    preview: str | None = None
    unresolved_questions: list[str] = []
    plan: dict | None = None
    data: dict | None = None


class NiFiSettings(BaseModel):
    host: str
    port: int
    protocol: str = "https"
    api_path: str = "/nifi-api"
    username: str | None = None
    password: str | None = None
    verify_ssl: bool = False


def _tool_result_text(data: dict) -> str:
    if "text" in data and len(data) == 1:
        return str(data["text"])
    return json.dumps(data, indent=2)[:4000]


def _ollama_tools(catalog: list[dict]) -> list[dict]:
    tools = []
    for t in catalog[:40]:
        schema = t.get("inputSchema") or {"type": "object", "properties": {}}
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description") or t["name"],
                    "parameters": schema,
                },
            }
        )
    return tools


def _tool_calls(message: dict) -> list[dict]:
    raw = message.get("tool_calls") or []
    calls = []
    for i, item in enumerate(raw):
        fn = item.get("function") or item
        args = fn.get("arguments") or item.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args) if args else {}
            except json.JSONDecodeError:
                args = {}
        calls.append(
            {
                "id": item.get("id") or f"call_{i}",
                "name": fn.get("name") or item.get("name"),
                "arguments": args if isinstance(args, dict) else {},
            }
        )
    return calls


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    message = req.message.strip()
    lowered = message.lower()

    try:
        routed = await route_catalog(message)
    except Exception as e:
        return ChatResponse(reply="Catalog action failed before Ollama. " + flatten_exc(e))
    if routed:
        return ChatResponse(
            reply=str(routed.get("reply") or "Done."),
            plan=routed.get("plan"),
            data=routed.get("data"),
        )

    if any(w in lowered for w in ("version", "connected nifi", "which nifi")):
        try:
            about = await NiFiRest().about()
            ver = about.get("version") or "unknown"
            return ChatResponse(
                reply=(
                    f"Connected NiFi version is {ver} at {about.get('baseUrl')}. "
                    "That value comes from GET /nifi-api/flow/about on the live instance, "
                    "not from the model."
                ),
                data=about,
            )
        except Exception as e:
            return ChatResponse(
                reply="Could not read /nifi-api/flow/about from the configured NiFi. " + flatten_exc(e)
            )

    if any(w in lowered for w in ("inspect root", "root process group", "summarize the root")):
        try:
            info = await NiFiRest().inspect_root()
            counts = info.get("flowCounts") or {}
            return ChatResponse(
                reply=(
                    f"Root process group '{info.get('name') or '(unnamed)'}' "
                    f"id={info.get('id')} on {info.get('baseUrl')}. "
                    f"Child groups={counts.get('processGroups')} "
                    f"processors={counts.get('processors')} "
                    f"connections={counts.get('connections')}."
                ),
                data=info,
            )
        except Exception as e:
            return ChatResponse(reply="Could not inspect the root process group. " + flatten_exc(e))

    if any(
        w in lowered
        for w in (
            "list idol nar",
            "nar versions",
            "nar profile",
            "compatibility matrix",
        )
    ):
        try:
            data = await call_kd_tool("list_idol_nar_versions", {})
            return ChatResponse(reply=_nar_banner(data) + "\n\n" + json.dumps({"profiles": data.get("profiles")}, indent=2)[:3500], data=data)
        except Exception as e:
            return ChatResponse(reply="Could not list NAR profiles. " + flatten_exc(e))

    if any(
        w in lowered
        for w in (
            "passage extraction",
            "aci command",
            "hot folder",
            "enterprise ingestion",
            "find search",
            "query integration",
            "llm enrichment",
            "generate_idol_nifi_flow",
            "idol 26.2",
            "idol 26.3",
            "using version 26.",
            "using idol 26.",
        )
    ) and "getfilesystem" not in lowered and "executedocumentpython" not in lowered:
        try:
            data = await call_kd_tool("generate_idol_nifi_flow", {"prompt": message})
            return ChatResponse(
                reply=_nar_banner(data),
                plan={"flowName": (data.get("spec") or {}).get("flowName"), "pattern": (data.get("spec") or {}).get("id"), "config": data},
                data=data,
            )
        except Exception as e:
            return ChatResponse(reply="Could not generate a version-aware IDOL flow. " + flatten_exc(e))

    if any(
        w in lowered
        for w in (
            "ai test with python",
            "executedocumentpython",
            "generatedocumentflowfile",
            "add_two_fields",
            "python sample",
        )
    ):
        try:
            created = await NiFiRest().create_ai_python_sample_flow()
            created["via"] = created.get("via") or "nifi-rest"
            return ChatResponse(
                reply=(
                    f"Created process group '{created.get('name')}' "
                    "(26.3.0-nifi2): IdolSslConfigServiceImpl + IdolLicenseServiceImpl, "
                    "GenerateDocumentFlowFile → ExecuteDocumentPython "
                    f"({created.get('scriptFile')}) → success/failure funnels. "
                    "Enable the two controller services before running a processor."
                ),
                plan={"flowName": created.get("name"), "pattern": "idol-ai-python", "config": created},
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="Could not create the AI Python sample. " + flatten_exc(e))

    if any(w in lowered for w in ("getfilesystem", "putidol", "26.3.0-nifi2")):
        try:
            created = await NiFiRest().create_idol_nifi2_sample_flow()
            created["via"] = created.get("via") or "nifi-rest"
            return ChatResponse(
                reply=(
                    f"Created IDOL 26.3.0-nifi2 flow '{created.get('name')}'. "
                    "Controller services: IdolSslConfigServiceImpl + IdolLicenseServiceImpl. "
                    "Processors: GetFileSystem → PutIDOL. Review and enable the services on the canvas before starting."
                ),
                plan={"flowName": created.get("name"), "pattern": "idol-nifi2-26.3", "config": created},
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="Could not create the 26.3.0-nifi2 sample. " + flatten_exc(e))

    if any(w in lowered for w in ("sap ingest", "kd sap", "sap repository")):
        try:
            created = await call_kd_tool("create_kd_sap_flow", {"sap_endpoint": "https://sap.internal/api/documents", "repository": "default"})
            return ChatResponse(
                reply=f"Created KD SAP ingest flow '{created.get('name')}'. Review it on the canvas before starting.",
                plan={"flowName": created.get("name"), "pattern": "sap", "config": created},
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="Could not create the SAP KD flow. " + flatten_exc(e))

    if any(w in lowered for w in ("documentum", "kd documentum")):
        try:
            created = await call_kd_tool("create_kd_documentum_flow", {"documentum_endpoint": "https://documentum.internal/dctm-rest/repositories/default"})
            return ChatResponse(
                reply=f"Created KD Documentum ingest flow '{created.get('name')}'. Review it on the canvas before starting.",
                plan={"flowName": created.get("name"), "pattern": "documentum", "config": created},
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="Could not create the Documentum KD flow. " + flatten_exc(e))

    if any(w in lowered for w in ("idol sample", "sample idol", "kd idol", "idol flow", "idol ingest")):
        try:
            created = await NiFiRest().create_idol_sample_flow()
            created["via"] = created.get("via") or "nifi-rest"
            return ChatResponse(
                reply=(
                    f"Created IDOL ingest flow '{created.get('name')}' "
                    f"(GetFile → Map KD metadata → InvokeHTTP /action=index). "
                    f"Source {created.get('sourcePath')} → "
                    f"{(created.get('idol') or {}).get('indexUrl')}. "
                    "Review it on the canvas before starting."
                ),
                plan={"flowName": created.get("name"), "pattern": "idol-file", "config": created},
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="Could not create the IDOL sample flow. " + flatten_exc(e))

    if any(w in lowered for w in ("sample", "example", "demo", "hello flow")):
        try:
            created = await _create_sample_flow()
            return ChatResponse(
                reply="Created a sample flow through the official NiFi MCP server (start_new_flow). Review it on the canvas, then start it if it looks right.",
                plan={
                    "flowName": created.get("name", "Sample Flow"),
                    "pattern": "sample",
                    "tool": "start_new_flow",
                    "config": created,
                },
                data=created,
            )
        except Exception as e:
            return ChatResponse(reply="I could not create the sample flow on NiFi yet. " + flatten_exc(e))

    ollama_health = await ollama.health()
    if not ollama_health.get("ok"):
        return ChatResponse(
            reply="Ollama is not reachable at "
            f"{ollama.base} (model {ollama.model}). Start Ollama on the host and pull the model: "
            f"`ollama pull {ollama.model}`. I can still create a sample flow if you ask for one. "
            f"Detail: {ollama_health.get('error')}",
            unresolved_questions=[f"Start Ollama and pull {ollama.model}"],
        )

    catalog: list[dict] = []
    try:
        catalog = await mcp_session.list_tools()
    except Exception:
        catalog = []
    # OpenText KD tools are served by this orchestrator, not Cloudera MCP.
    existing = {t.get("name") for t in catalog}
    for tool in kd_tool_catalog():
        if tool["name"] not in existing:
            catalog.append(tool)

    tools = _ollama_tools(catalog)
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": message},
    ]
    final_text = ""
    last_data: dict | None = None

    try:
        for _ in range(8):
            reply = await ollama.chat(messages, tools=tools or None)
            content = (reply.get("content") or "").strip()
            if content:
                final_text = content
            calls = _tool_calls(reply)
            messages.append(reply)
            if not calls:
                break
            for call in calls:
                name = call.get("name") or ""
                try:
                    if name in kd_tool_names():
                        data = await call_kd_tool(name, call.get("arguments") or {})
                    else:
                        data = await mcp_session.call_tool(name, call.get("arguments") or {})
                    last_data = data
                    payload = _tool_result_text(data)
                except Exception as e:
                    payload = flatten_exc(e)
                messages.append({"role": "tool", "content": payload, "tool_name": name})
    except OllamaError as e:
        return ChatResponse(reply=str(e))

    return ChatResponse(reply=final_text or "Done.", data=last_data)


async def _mcp_start_new_flow(flow_name: str) -> dict:
    """Create a process group through the official Cloudera NiFi MCP server."""
    root = await mcp_session.call_tool("get_root_process_group", {})
    root_id = (
        root.get("id")
        or root.get("processGroupId")
        or (root.get("component") or {}).get("id")
    )
    args = {"flow_name": flow_name}
    if isinstance(root_id, str) and root_id:
        args["parent_pg_id"] = root_id
    created = await mcp_session.call_tool("start_new_flow", args)
    return {"via": "official-mcp", "name": flow_name, "root": root, "created": created}


async def _create_sample_flow() -> dict:
    errors: list[str] = []
    try:
        return await _mcp_start_new_flow("Sample GenerateFlowFile")
    except Exception as e:
        errors.append("mcp: " + flatten_exc(e))
    try:
        rest = NiFiRest()
        created = await rest.create_sample_flow()
        created["via"] = "nifi-rest-fallback"
        created["mcpError"] = errors[-1] if errors else ""
        return created
    except Exception as e:
        errors.append("rest: " + flatten_exc(e))
    raise RuntimeError(" ; ".join(errors))


@app.post("/flows/sample")
async def sample_flow() -> dict:
    try:
        return await _create_sample_flow()
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/settings/nifi")
async def get_nifi_settings() -> dict:
    info = {
        "apiBase": os.environ.get("NIFI_API_BASE"),
        "apiBases": os.environ.get("NIFI_API_BASES"),
        "username": os.environ.get("NIFI_USERNAME", "admin"),
        "uiHint": "Open NiFi over HTTPS on the published TLS port, e.g. https://20.86.52.130:27111/nifi — http://HOST:27111/nifi/#/error is Unauthorized.",
    }
    try:
        info["about"] = await NiFiRest().about()
        info["ok"] = True
    except Exception as e:
        info["ok"] = False
        info["error"] = flatten_exc(e)
    try:
        info["mcp"] = await mcp_session.call_tool("check_configuration", {})
    except Exception as e:
        info["mcpError"] = flatten_exc(e)
    return info


@app.put("/settings/nifi")
async def put_nifi_settings(settings: NiFiSettings) -> dict:
    raise HTTPException(
        400,
        "The official NiFi MCP server reads NIFI_API_BASE / NIFI_USERNAME / NIFI_PASSWORD "
        f"from the container environment. Point it at {settings.protocol}://{settings.host}:{settings.port}{settings.api_path} "
        "in docker-compose.yml and recreate nifi-kd-mcp.",
    )


@app.get("/nifi/about")
async def nifi_about() -> dict:
    try:
        return await NiFiRest().about()
    except Exception as e:
        raise HTTPException(502, flatten_exc(e))


@app.post("/settings/nifi/test")
async def test_nifi() -> dict:
    errors: list[str] = []
    try:
        about = await NiFiRest().about()
        return {
            "ok": True,
            "via": "rest",
            "version": about.get("version"),
            "about": about,
        }
    except Exception as e:
        errors.append("rest: " + flatten_exc(e))
    try:
        version = await mcp_session.call_tool("get_nifi_version", {})
        return {"ok": True, "via": "mcp", "version": version}
    except Exception as e:
        errors.append("mcp: " + flatten_exc(e))
    return {"ok": False, "error": " ; ".join(errors)}


class CustomTemplate(BaseModel):
    title: str
    description: str = ""
    prompt: str


@app.get("/lookup/templates")
async def lookup_templates(q: str = "") -> dict:
    return {"items": list_lookup_templates(q)}


@app.post("/lookup/templates")
async def add_template(item: CustomTemplate) -> dict:
    title = item.title.strip()
    if not title:
        raise HTTPException(400, "title is required")
    try:
        return persist_custom_template(title, item.description, item.prompt)
    except OSError as e:
        raise HTTPException(500, f"Could not write templates/custom: {e}")


class CatalogObject(BaseModel):
    title: str = ""
    name: str = ""
    description: str = ""
    prompt: str = ""
    needs: str = ""
    kind: str = "action"
    required: list = Field(default_factory=list)


def _lookup_kind(kind: str, q: str = "") -> dict:
    items = list_lookup_kind(kind, q)
    return {"items": items, "count": len(items), "kind": kind}


@app.get("/lookup/actions")
async def lookup_actions(q: str = "") -> dict:
    return _lookup_kind("action", q)


@app.get("/lookup/skills")
async def lookup_skills(q: str = "") -> dict:
    return _lookup_kind("skill", q)


@app.get("/lookup/objects")
async def lookup_objects(q: str = "") -> dict:
    items = list_lookup_objects(q)
    return {"items": items, "count": len(items)}


@app.post("/lookup/actions")
async def add_action(item: CatalogObject) -> dict:
    return persist_custom_object(
        "action",
        item.title or item.name,
        item.description,
        item.prompt,
        item.needs,
        item.required,
    )


@app.post("/lookup/skills")
async def add_skill(item: CatalogObject) -> dict:
    return persist_custom_object(
        "skill",
        item.title or item.name,
        item.description,
        item.prompt,
        item.needs,
        item.required,
    )


@app.post("/lookup/objects")
async def add_object(item: CatalogObject) -> dict:
    kind = item.kind if item.kind in ("action", "skill", "template") else "action"
    try:
        return persist_custom_object(
            kind,
            item.title or item.name,
            item.description,
            item.prompt,
            item.needs,
            item.required,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except OSError as e:
        raise HTTPException(500, f"Could not write templates/custom: {e}")


def _fill_prompt(template: str, values: dict) -> str:
    import re

    def repl(match: re.Match) -> str:
        key = match.group(1)
        val = values.get(key)
        return str(val) if val is not None and val != "" else ""

    filled = re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", repl, template or "")
    filled = re.sub(r"\$\{\s*([a-zA-Z0-9_]+)\s*\}", repl, filled)
    return " ".join(filled.split()).strip()


async def run_object_call(args: dict) -> dict:
    """Execute a sidebar object on the orchestrator (same path as POST /chat)."""
    kind = args.get("kind")
    name = str(args.get("name") or args.get("title") or "").strip()
    values = args.get("values") if isinstance(args.get("values"), dict) else {}
    prompt = str(args.get("prompt") or "").strip()
    if not prompt and name:
        found = find_object(kind if kind in ("action", "skill", "template") else None, name)
        if found:
            prompt = str(found.get("prompt") or found.get("title") or "")
            kind = found.get("kind") or kind
    if values and prompt:
        prompt = _fill_prompt(prompt, values)
    if not prompt:
        return {"ok": False, "error": "runObject needs a prompt or a known object name"}
    result = await chat(ChatRequest(message=prompt))
    return {
        "ok": True,
        "kind": kind,
        "name": name,
        "prompt": prompt,
        "reply": result.reply,
        "plan": result.plan,
        "data": result.data,
    }


async def dispatch_mcp_tool(name: str, args: dict) -> dict:
    args = args or {}
    if name == "runObject":
        return await run_object_call(args)
    if name == "refreshObjects":
        items = list_lookup_objects()
        kinds = args.get("kinds") or ["action", "skill", "template"]
        if isinstance(kinds, str):
            kinds = [k.strip() for k in kinds.split(",") if k.strip()]
        items = [i for i in items if (i.get("kind") or "template") in set(kinds)]
        return {"ok": True, "items": items, "count": len(items), "kinds": kinds}
    if name == "listObjects":
        items = list_lookup_objects(str(args.get("q") or ""))
        return {"ok": True, "items": items, "count": len(items)}
    if name == "addObject":
        kind = args.get("kind") if args.get("kind") in ("action", "skill", "template") else "action"
        title = str(args.get("title") or args.get("name") or "").strip()
        if not title:
            return {"ok": False, "error": "addObject requires name/title"}
        rec = persist_custom_object(
            kind,
            title,
            str(args.get("description") or ""),
            str(args.get("prompt") or ""),
            str(args.get("needs") or ""),
            list(args.get("required") or []),
        )
        rec.pop("_path", None)
        return {"ok": True, "item": rec}
    if name == "deleteObject":
        kind = args.get("kind") if args.get("kind") in ("action", "skill", "template") else "template"
        title = str(args.get("title") or args.get("name") or "").strip()
        removed = delete_custom_object(kind, title)
        return {"ok": True, "removed": removed, "kind": kind, "name": title}
    if name == "clearAllObjects":
        kinds = args.get("kinds") or ["action", "skill", "template"]
        if isinstance(kinds, str):
            kinds = [k.strip() for k in kinds.split(",") if k.strip()]
        count = clear_custom_objects(list(kinds))
        return {"ok": True, "cleared": count, "kinds": kinds}
    return {"ok": False, "error": f"Unknown MCP tool '{name}'"}


MCP_TOOLS = [
    {
        "name": "runObject",
        "description": "Run a NiFi AI action, skill, or template on the orchestrator.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["action", "skill", "template"]},
                "name": {"type": "string"},
                "prompt": {"type": "string"},
                "values": {"type": "object"},
            },
        },
    },
    {
        "name": "refreshObjects",
        "description": "Return the current Actions / Skills / Templates catalog.",
        "inputSchema": {"type": "object", "properties": {"kinds": {"type": "array", "items": {"type": "string"}}}},
    },
    {
        "name": "listObjects",
        "description": "List catalog objects.",
        "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}},
    },
    {
        "name": "addObject",
        "description": "Persist an Action, Skill, or Template on the server.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "name": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "prompt": {"type": "string"},
                "needs": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "deleteObject",
        "description": "Delete a custom Action, Skill, or Template from the server.",
        "inputSchema": {
            "type": "object",
            "properties": {"kind": {"type": "string"}, "name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "clearAllObjects",
        "description": "Delete custom catalog objects from the server.",
        "inputSchema": {"type": "object", "properties": {"kinds": {"type": "array", "items": {"type": "string"}}}},
    },
]


@app.post("/mcp")
async def mcp_jsonrpc(body: dict) -> dict:
    method = body.get("method") or ""
    req_id = body.get("id")
    params = body.get("params") or {}
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "kd-nifi-ai-orchestrator", "version": "0.4.2"},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}
    if method == "tools/call":
        name = (params.get("name") if isinstance(params, dict) else None) or ""
        args = (params.get("arguments") if isinstance(params, dict) else None) or {}
        try:
            result = await dispatch_mcp_tool(str(name), args if isinstance(args, dict) else {})
        except Exception as e:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": flatten_exc(e)},
            }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, default=str)[:8000]}],
                "structuredContent": result,
            },
        }
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Unknown method {method}"},
    }


@app.post("/api/nifi-ai/clear-all")
async def nifi_ai_clear_all(body: dict | None = None) -> dict:
    payload = body or {}
    kinds = payload.get("kinds") or ["action", "skill", "template"]
    if isinstance(kinds, str):
        kinds = [k.strip() for k in kinds.split(",") if k.strip()]
    count = clear_custom_objects(list(kinds))
    return {"ok": True, "method": payload.get("method") or "clearAllObjects", "cleared": count, "kinds": kinds}


@app.post("/api/nifi-ai/run")
async def nifi_ai_run(body: dict | None = None) -> dict:
    return await run_object_call(body or {})


@app.get("/lookup/processors")
async def lookup_processors(q: str = "") -> dict:
    try:
        data = await mcp_session.call_tool("get_processor_types", {})
    except Exception as e:
        raise HTTPException(502, str(e))
    items = []
    blob = data.get("processorTypes") or data.get("types") or data.get("result") or data
    rows = blob if isinstance(blob, list) else []
    needle = q.lower()
    for t in rows[:80]:
        type_name = t.get("type") or t.get("typeName") or ""
        title = type_name.rsplit(".", 1)[-1]
        if needle and needle not in type_name.lower():
            continue
        items.append({"id": type_name, "kind": "processor", "title": title, "description": t.get("description") or type_name, "type": type_name})
    if not items and isinstance(data, dict) and data.get("text"):
        items.append({"id": "raw", "kind": "processor", "title": "processor types", "description": str(data["text"])[:200]})
    return {"items": items, "count": len(items)}


@app.get("/lookup/process-groups")
async def lookup_process_groups() -> dict:
    try:
        root = await mcp_session.call_tool("get_root_process_group", {})
        return {"items": [{"id": root.get("id") or "root", "kind": "process-group", "title": root.get("name") or "root", "description": json.dumps(root)[:200]}], "root": root}
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/lookup/kd-tools")
async def lookup_kd_tools() -> dict:
    return {"items": kd_tool_catalog(), "count": len(kd_tool_catalog())}


class KdToolCall(BaseModel):
    arguments: dict = {}


@app.post("/kd/tools/{name}")
async def run_kd_tool(name: str, request: Request, body: KdToolCall | None = None) -> dict:
    if name not in kd_tool_names():
        raise HTTPException(404, f"Unknown KD tool '{name}'. Known: {sorted(kd_tool_names())}")
    require_gateway(name, request)
    try:
        return await call_kd_tool(name, (body.arguments if body else {}))
    except Exception as e:
        raise HTTPException(502, flatten_exc(e))


@app.get("/health")
async def health() -> dict:
    mcp = await mcp_session.health()
    llm = await ollama.health()
    return {"status": "ok" if mcp.get("ok") or llm.get("ok") else "degraded", "llm": llm, "mcp": mcp}
