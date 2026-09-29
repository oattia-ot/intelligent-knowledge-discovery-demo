# Migration — version-aware IDOL NiFi NARs

Existing 0.3.x installs keep working. The official Cloudera MCP entrypoint, chat UI, proxy, and previous KD REST samples are unchanged.

## What changed

- New package `mcp-server/nar/` owns version selection.
- New tools: `list_idol_nar_versions`, `resolve_idol_nars`, `validate_idol_nar_compatibility`, `get_idol_nar_manifest`, `generate_idol_nifi_flow`, `validate_generated_idol_flow`, `install_idol_nars`, `diagnose_idol_nifi_environment`.
- New on-disk registry: `nars/26.2/`, `nars/26.3/`, `nars/compatibility-matrix.json`.
- Compose now mounts `./nars` and accepts `IDOL_VERSION` / `NIFI_VERSION` / `IDOL_NAR_PATH`.
- Ten reference flows live in `templates/reference-flows/`.

## What you must do

1. Rebuild `mcp-server` and `ai-orchestrator` so the new Python modules are in the images.
2. Copy `.env.example` keys into `.env` if you want a default target version.
3. If you run local NiFi, set `NIFI_IMAGE` to the image tag that matches `IDOL_VERSION` (`microfocusidolserver/nifi-ver2-full:26.2` or `:26.3`). Do not reuse one tag for both trains.
4. Proprietary `.nar` files are still not in git. The 26.3 full image already contains its NARs. For 26.2 local install mode, drop the 26.2 package into `nars/26.2/`.
5. Chat prompts that name `26.2` or `26.3` now go through the resolver before a flow is emitted.

## What you should not do

- Do not copy 26.3 NARs into `nars/26.2/` (or the reverse).
- Do not introduce a `nars/latest/` directory.
- Do not put IDOL passwords into generated flow JSON.

## Rollback

Remove the new env vars and the `./nars` volume. The previous `create_kd_*` REST tools and Cloudera MCP path remain.
