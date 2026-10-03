"""AI gateway: identity, tool allow-list, audit, models vs tools, A2A approval.

This is the only browser-facing ingress for the knowledge topology.
- Questions go to Answer Server (models). They never call MCP or Ollama directly.
- Actions go to the KD tool catalog (tools via MCP) and only after an A2A approval.
- The flow agent cannot deploy a NiFi flow the search agent merely proposed.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ALLOWLIST_PATH = Path(os.environ.get("TOOL_ALLOWLIST", "/app/tool_allowlist.json"))
AUDIT_PATH = Path(os.environ.get("AUDIT_PATH", "/data/audit.jsonl"))
GATEWAY_TOKEN = os.environ.get("GATEWAY_API_TOKEN", "")
LAB_TOKEN = "change-me"
SHARED_SECRET = os.environ.get("GATEWAY_SHARED_SECRET", "")
ANSWER_SERVER_URL = os.environ.get("ANSWER_SERVER_URL", "http://answerserver:12000").rstrip("/")
ANSWER_SYSTEM = os.environ.get("ANSWER_SYSTEM_NAME", "MyAnswerSystem")
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://ai-orchestrator:8080").rstrip("/")
ENFORCE = os.environ.get("GATEWAY_ENFORCE", "true").lower() != "false"

MUTATING = {
    "create_kd_file_connector_flow",
    "create_kd_idol_nifi2_flow",
    "create_kd_ai_python_flow",
    "create_kd_sap_flow",
    "create_kd_documentum_flow",
}

app = FastAPI(title="KD AI Gateway", version="1.0.0")
TASKS: dict[str, dict[str, Any]] = {}


def _allowlist() -> dict[str, Any]:
    return json.loads(ALLOWLIST_PATH.read_text())


def _audit(event: str, **fields: Any) -> None:
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **fields}
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AUDIT_PATH.open("a") as fh:
        fh.write(json.dumps(row) + "\n")


def _identity(authorization: str | None) -> str:
    if not ENFORCE:
        return "lab"
    if not GATEWAY_TOKEN or GATEWAY_TOKEN == LAB_TOKEN:
        raise HTTPException(503, "GATEWAY_API_TOKEN is unset or still the lab placeholder")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    if token != GATEWAY_TOKEN:
        raise HTTPException(403, "Identity rejected")
    return "gateway-user"


class AskRequest(BaseModel):
    question: str
    sessionId: str | None = None
    agent: str = "search-agent"


class ToolInvoke(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)
    approvalId: str | None = None
    agent: str = "flow-agent"


class A2ATaskCreate(BaseModel):
    intent: str
    proposedTool: str
    arguments: dict = Field(default_factory=dict)
    fromAgent: str = "search-agent"
    toAgent: str = "flow-agent"


class A2APlan(BaseModel):
    summary: str
    tool: str
    arguments: dict = Field(default_factory=dict)


class A2AApprove(BaseModel):
    approver: str = "human"
    comment: str = ""


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "enforce": ENFORCE,
        "models": ANSWER_SERVER_URL,
        "tools": ORCHESTRATOR_URL,
        "tokenConfigured": bool(GATEWAY_TOKEN) and GATEWAY_TOKEN != LAB_TOKEN,
    }


@app.get("/v1/tools")
def tools(authorization: str | None = Header(default=None)) -> dict:
    _identity(authorization)
    catalog = _allowlist()
    return {"tools": catalog["tools"], "policy": catalog["policy"]}


@app.post("/v1/models/ask")
async def models_ask(body: AskRequest, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    # Models path. Never forwarded to MCP.
    url = f"{ANSWER_SERVER_URL}/action=Ask"
    params = {"Text": body.question, "SystemName": ANSWER_SYSTEM, "ResponseFormat": "json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(url, params=params)
            payload: Any
            try:
                payload = resp.json()
            except Exception:
                payload = {"raw": resp.text[:2000]}
            grounded = True
    except httpx.HTTPError as exc:
        payload = {
            "status": "unavailable",
            "detail": str(exc),
            "note": "Answer Server is the models path. The gateway did not call Ollama or MCP.",
        }
        grounded = False
    _audit("models.ask", actor=who, agent=body.agent, question=body.question, grounded=grounded)
    return {"path": "models", "agent": body.agent, "grounded": grounded, "answer": payload}


@app.post("/v1/tools/invoke")
async def tools_invoke(body: ToolInvoke, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    allowed = {t["name"]: t for t in _allowlist()["tools"]}
    spec = allowed.get(body.name)
    if not spec:
        _audit("tools.denied", actor=who, tool=body.name, reason="not-allowlisted")
        raise HTTPException(403, f"Tool '{body.name}' is not on the gateway allow-list")
    if spec.get("class") != "tool":
        raise HTTPException(400, f"'{body.name}' is a {spec.get('class')} path, not a tool")
    if body.name in MUTATING or spec.get("mutating"):
        task = TASKS.get(body.approvalId or "")
        if not task or task.get("state") != "approved":
            _audit("tools.denied", actor=who, tool=body.name, reason="approval-required")
            raise HTTPException(409, "Mutating tools require an approved A2A task id in approvalId")
        if task.get("tool") != body.name:
            raise HTTPException(409, "Approval is for a different tool")
    return await _execute(who, body.name, body.arguments, body.approvalId, body.agent)


@app.post("/v1/a2a/tasks")
def a2a_create(body: A2ATaskCreate, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    if body.fromAgent != "search-agent":
        raise HTTPException(403, "Only the search agent may open an A2A task")
    allowed = {t["name"] for t in _allowlist()["tools"] if t.get("class") == "tool"}
    if body.proposedTool not in allowed:
        raise HTTPException(403, "Proposed tool is not allow-listed")
    task_id = uuid.uuid4().hex[:12]
    TASKS[task_id] = {
        "id": task_id,
        "state": "proposed",
        "intent": body.intent,
        "tool": body.proposedTool,
        "arguments": body.arguments,
        "fromAgent": body.fromAgent,
        "toAgent": body.toAgent,
        "plan": None,
        "approval": None,
    }
    _audit("a2a.proposed", actor=who, task=task_id, tool=body.proposedTool, intent=body.intent)
    return TASKS[task_id]


@app.post("/v1/a2a/tasks/{task_id}/plan")
def a2a_plan(task_id: str, body: A2APlan, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    task = _task(task_id)
    if task["state"] != "proposed":
        raise HTTPException(409, f"Cannot plan from state {task['state']}")
    task["state"] = "planned"
    task["plan"] = body.model_dump()
    task["tool"] = body.tool
    task["arguments"] = body.arguments
    _audit("a2a.planned", actor=who, task=task_id, tool=body.tool, summary=body.summary)
    return task


@app.post("/v1/a2a/tasks/{task_id}/approve")
def a2a_approve(task_id: str, body: A2AApprove, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    task = _task(task_id)
    if task["state"] != "planned":
        raise HTTPException(409, "Approve only a planned task. The search agent cannot skip the flow agent.")
    task["state"] = "approved"
    task["approval"] = {"approver": body.approver, "comment": body.comment, "actor": who}
    _audit("a2a.approved", actor=who, task=task_id, approver=body.approver)
    return task


@app.post("/v1/a2a/tasks/{task_id}/execute")
async def a2a_execute(task_id: str, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    task = _task(task_id)
    if task["state"] != "approved":
        _audit("a2a.denied", actor=who, task=task_id, state=task["state"])
        raise HTTPException(409, "Flow agent may execute only after human approval")
    result = await _execute(who, task["tool"], task["arguments"], task_id, "flow-agent")
    task["state"] = "completed"
    task["result"] = result
    return task


@app.get("/v1/a2a/tasks/{task_id}")
def a2a_get(task_id: str, authorization: str | None = Header(default=None)) -> dict:
    _identity(authorization)
    return _task(task_id)


class EventIn(BaseModel):
    source: str = "nifi-provenance"
    summary: str
    agent: str = "event-forwarder"


@app.post("/v1/events")
def ingest_event(body: EventIn, authorization: str | None = Header(default=None)) -> dict:
    who = _identity(authorization)
    _audit("events.ingest", actor=who, source=body.source, agent=body.agent, summary=body.summary)
    return {"ok": True, "path": "events"}


@app.get("/v1/audit")
def audit(authorization: str | None = Header(default=None), limit: int = 50) -> dict:
    _identity(authorization)
    if not AUDIT_PATH.exists():
        return {"events": []}
    lines = AUDIT_PATH.read_text().splitlines()[-limit:]
    return {"events": [json.loads(line) for line in lines if line.strip()]}


def _task(task_id: str) -> dict:
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(404, "Unknown A2A task")
    return task


async def _execute(actor: str, name: str, arguments: dict, approval_id: str | None, agent: str) -> dict:
    headers = {
        "X-Gateway-Secret": SHARED_SECRET,
        "X-Gateway-Approval": approval_id or "",
        "X-Gateway-Actor": actor,
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{ORCHESTRATOR_URL}/kd/tools/{name}",
                json={"arguments": arguments},
                headers=headers,
            )
            data = resp.json() if resp.content else {}
            if resp.status_code >= 400:
                _audit("tools.error", actor=actor, agent=agent, tool=name, approval=approval_id, status=resp.status_code)
                raise HTTPException(resp.status_code, data)
    except httpx.HTTPError as exc:
        _audit("tools.error", actor=actor, agent=agent, tool=name, approval=approval_id, error=str(exc))
        raise HTTPException(502, f"Orchestrator unreachable: {exc}") from exc
    _audit("tools.executed", actor=actor, agent=agent, tool=name, approval=approval_id)
    return {"path": "tools", "tool": name, "approvalId": approval_id, "result": data}
