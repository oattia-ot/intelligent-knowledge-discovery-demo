# Capability registry

Source of truth is generated from `mcp-server/kd/catalog.py`.

- `capabilities.json` — capabilities, skills, workflows, documentation URLs
- Rebuild: `python3 -c "from kd.registry import CapabilityRegistry; CapabilityRegistry().write_json()"` from `mcp-server/`

Target version: Knowledge Discovery 26.3.
