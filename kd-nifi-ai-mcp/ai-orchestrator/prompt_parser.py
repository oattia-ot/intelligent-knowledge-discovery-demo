"""
prompt_parser.py

Step 1-2 of the orchestrator pipeline: understand the user's natural
language request and match it to a known Knowledge Discovery flow
pattern (see kd_templates.py). In production this call goes to an LLM
(e.g. the Claude API) with a system prompt describing the available
patterns and a JSON output schema; this module defines that contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field


SYSTEM_PROMPT = """You are a flow-planning assistant for Apache NiFi and \
OpenText Knowledge Discovery (IDOL). Given a user's natural-language request, \
identify:
  1. which KD flow pattern(s) it matches (file, sap, database, rest, sharepoint,
     documentum, xecm, enrichment-only)
  2. the configuration values needed for that pattern (paths, hosts, ports,
     repositories, filters, index names)
  3. whether an enrichment/metadata-mapping stage should be inserted

Respond ONLY with JSON matching this schema:
{
  "pattern": "file" | "sap" | "database" | "rest" | "sharepoint" | "documentum" | "xecm",
  "flowName": string,
  "config": { ...pattern-specific keys... },
  "needsEnrichment": boolean,
  "unresolvedQuestions": [string]   // ask the user if anything required is missing
}
"""


@dataclass
class ParsedIntent:
    pattern: str
    flow_name: str
    config: dict = field(default_factory=dict)
    needs_enrichment: bool = False
    unresolved_questions: list[str] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        return len(self.unresolved_questions) == 0


def parse_llm_response(raw_json: dict) -> ParsedIntent:
    """Convert the LLM's JSON response into a ParsedIntent, defaulting
    missing optional fields."""
    return ParsedIntent(
        pattern=raw_json["pattern"],
        flow_name=raw_json.get("flowName", "Untitled KD Flow"),
        config=raw_json.get("config", {}),
        needs_enrichment=raw_json.get("needsEnrichment", False),
        unresolved_questions=raw_json.get("unresolvedQuestions", []),
    )
