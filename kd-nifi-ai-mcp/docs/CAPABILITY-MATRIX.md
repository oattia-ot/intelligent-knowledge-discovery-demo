# Knowledge Discovery capability matrix

Generated from `knowledge-discovery/capabilities/capabilities.json`.
Target product version: **26.3**.

## How to read

`version → component → API/action → MCP skill → MCP tool → parameters → documentation`

Full machine-readable rows: `knowledge-discovery/capabilities/capabilities.json` and `mcp-server/kd/data/capabilities.json`.

## Components in the registry

Agentstore, AnswerServer, CFS, Category, Community, Content, DAH, DIH, Eduction, FileContentExtraction, KnowledgeGraph, LicenseServer, MediaServer, NiFiIngest, OmniGroupServer, Proxy, QMS, View.

## High-value mappings

| Version | Component | Action | Skill | Tool | Key parameters | Docs |
|---|---|---|---|---|---|---|
| 26.3 | Content | Query | idol_content_search | kd_content_query | Text, FieldText, DatabaseMatch, MaxResults, SecurityInfo | Content Query Help (inherited 26.1 topic still valid) |
| 26.3 | Content | GetContent | idol_content_retrieve | kd_content_get | ID, Reference, Print | Content Help |
| 26.3 | Content | Suggest | idol_content_similarity | kd_content_suggest | ID, UseVectors | 26.3 UseVectors note |
| 26.3 | Content | TermGetBest | idol_content_search | kd_content_term_get_best | Text, UseVectors | 26.3 What’s New |
| 26.3 | Content | GetQueryTagValues | idol_content_parametric | kd_content_parametric | FieldName, Text | FieldText Help |
| 26.3 | Content | DREADDDATA | idol_content_index | kd_content_index_data | body IDX/XML, DREDbName | Getting Started index/query |
| 26.3 | Content | DREDELETEDOC | idol_content_index | kd_content_delete | Docs, confirm | Getting Started |
| 26.3 | Content | DREINITIAL | idol_content_admin | kd_content_initialize | confirm | Getting Started |
| 26.3 | DAH | Suggest | kd_distributed_search | kd_dah_suggest | UseVectors | 26.3 What’s New |
| 26.3 | QMS | Query | kd_query_manipulation | kd_qms_query | Text, SecurityInfo | Text analytics Help |
| 26.3 | View | View | idol_content_retrieve | kd_view_document | Reference | View Help |
| 26.3 | Category | CategorySuggestFromText | kd_classification | kd_category_suggest_from_text | QueryText | Category Help |
| 26.3 | Eduction | EduceFromText | kd_entity_extraction | kd_educe_text | Text, Grammars | 26.3 What’s New |
| 26.3 | Community | Security | kd_security | kd_security_info | UserName | Document security guide |
| 26.3 | MediaServer | Process (OCR) | kd_ocr | kd_media_ocr | SourcePath, Languages | Media OCR Help |
| 26.3 | MediaServer | Process (STT) | kd_speech_to_text | kd_media_speech_to_text | LanguagePack, ModelSize | Media 26.2 RN + 26.3 blog |
| 26.3 | MediaServer | Process (ImageDescription) | kd_image_description | kd_media_image_description | SourcePath | Media 26.2 RN |
| 26.3 | CFS | Synchronize | kd_ingest | kd_connector_synchronize | Identifier | CFS Help |
| 26.3 | FileContentExtraction | KeyViewFilter | kd_file_content_extraction | kd_fce_describe | n/a (NiFi/CFS) | FCE 26.3 portal |
| 26.3 | NiFiIngest | PutIDOL | kd_nifi_ingest | resolve_idol_nars | idolVersion=26.3 | NAR matrix |

## 26.3-specific behaviour encoded in metadata

- Speech-to-text Medium and Large names resolve to one combined model.
- `UseVectors` accepted on Suggest / TermGetBest (DAH/Content).
- Community OTDS username/password via `OTDSUserField` (server config; documented on the skill).
- OCR language additions: hy, az, ka, id, kk, ms, mn, tg, uz.
- Eduction: Saudi PII family, Oman/UAE improvements, ITAR munitions dictionary.
- File Content Extraction: C2PA provenance, 85 formats, source-code module.

## Discovery tools

| Question | Tool |
|---|---|
| What Knowledge Discovery skills are available? | `kd_list_skills` |
| What APIs are available in 26.3? | `kd_list_capabilities` |
| Find the correct API for this task | `kd_find_api` |
