"""Reject mutating KD tool calls that did not come through the AI gateway."""

from __future__ import annotations

import os

from fastapi import HTTPException, Request

MUTATING = {
    "create_kd_file_connector_flow",
    "create_kd_idol_nifi2_flow",
    "create_kd_ai_python_flow",
    "create_kd_sap_flow",
    "create_kd_documentum_flow",
}


def require_gateway(name: str, request: Request) -> None:
    if os.environ.get("GATEWAY_ENFORCE", "true").lower() == "false":
        return
    if name not in MUTATING:
        return
    secret = os.environ.get("GATEWAY_SHARED_SECRET", "")
    if not secret:
        raise HTTPException(503, "GATEWAY_SHARED_SECRET is required when gateway enforcement is on")
    if request.headers.get("X-Gateway-Secret") != secret:
        raise HTTPException(403, "Mutating tools are only callable through the AI gateway")
    if not request.headers.get("X-Gateway-Approval"):
        raise HTTPException(409, "Missing A2A approval id")
