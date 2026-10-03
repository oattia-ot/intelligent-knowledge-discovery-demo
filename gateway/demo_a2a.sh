#!/usr/bin/env bash
# End-to-end A2A walkthrough against a locally running gateway.
# Search agent proposes, flow agent plans, human approves, flow agent executes.
set -euo pipefail
BASE="${GATEWAY_URL:-http://localhost:27100}"
TOKEN="${GATEWAY_API_TOKEN:-change-me}"
AUTH="Authorization: Bearer ${TOKEN}"

echo "1) search-agent proposes a connector (no deploy)"
TASK=$(curl -fsS -X POST "$BASE/v1/a2a/tasks" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"intent":"index the contracts folder","proposedTool":"create_kd_file_connector_flow","arguments":{"flow_name":"contracts","source_path":"/data/contracts"}}')
echo "$TASK"
ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$TASK")

echo "2) flow-agent attaches a plan (still no deploy)"
curl -fsS -X POST "$BASE/v1/a2a/tasks/$ID/plan" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"summary":"GetFile /data/contracts -> IDOL Content :9100","tool":"create_kd_file_connector_flow","arguments":{"flow_name":"contracts","source_path":"/data/contracts","idol_host":"idol-content","idol_port":"9100"}}'
echo

echo "3) human approves"
curl -fsS -X POST "$BASE/v1/a2a/tasks/$ID/approve" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"approver":"human","comment":"approved for lab"}'
echo

echo "4) flow-agent executes — gateway calls orchestrator only now"
curl -sS -X POST "$BASE/v1/a2a/tasks/$ID/execute" -H "$AUTH" -H 'content-type: application/json' || true
echo
echo "5) audit trail"
curl -fsS "$BASE/v1/audit" -H "$AUTH"
echo
