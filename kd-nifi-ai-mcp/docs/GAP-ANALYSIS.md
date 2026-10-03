# Knowledge Discovery MCP gap analysis

Date: 2026-09-22 (pass 2)
Target: OpenText Knowledge Discovery **26.3**

## Inventory counts

| Bucket | Count |
|---|---|
| Registry capabilities | see live `capabilities.json` |
| MCP tools in `tools/knowledge_discovery.py` | 90+ |
| Expert skills | 28 |
| Expert workflows | 28 |
| Components represented | 18 |
| Unit tests (KD layer) | 25+ |
| Unit tests (NAR regression) | 31 |
| Live ACI tests | 0 |

## Weighted completion (pass 2)

Previous estimate: 81.8%. This pass added documented Answer Server, Knowledge Graph, Media face training, OGS/Community decrypt, and the official 26.3 connector catalog.

| Area | Weight | Coverage | Weighted |
|---|---|---|---|
| Core platform / discovery / version | 10 | 0.96 | 9.6 |
| Content search / retrieve / parametric | 18 | 0.94 | 16.9 |
| Content index / admin | 10 | 0.90 | 9.0 |
| DAH / DIH / QMS / View / Agentstore | 8 | 0.84 | 6.7 |
| Category / Eduction / text analytics | 10 | 0.88 | 8.8 |
| Security / Community / OGS | 8 | 0.88 | 7.0 |
| Media Server (process + face training) | 12 | 0.90 | 10.8 |
| File Content Extraction | 5 | 0.75 | 3.8 |
| CFS / connector catalog | 7 | 0.78 | 5.5 |
| NiFi Ingest / NAR | 7 | 0.90 | 6.3 |
| Answer Server + Knowledge Graph | 5 | 0.84 | 4.2 |

**Estimated completion = 92%** of achievable MCP-representable 26.3 capability.

Live execution against a licensed farm is still not included.

## Closed in this pass

- Answer Server Ask, GetResources, Converse, GetJobStatus, ManageResources (26.2 Help; component listed on 26.3 portal)
- Knowledge Graph GetNeighbors, GetNeighborhood, GetCommonNeighbors, GetShortestPath, GetSubgraph, SuggestLinks, GetNodes, SummarizeGraph
- Media TrainFace, ListFaces, ListFaceDatabases, RemoveFace, BuildFace, ListSpeakers
- Community UserDecryptSecurityInfo, UserDelete
- OmniGroupServer GetAllUsers
- Official 26.3 connector catalog (no invented per-repo endpoints)
- Content TermExpand, GetChildren

## Remaining gaps

- Find / Data Admin / Site Admin REST (Java webapps)
- Per-repository connector parameter pages (still config, not ACI)
- Additional Media training (objects other than BuildObjectClassRecognizer, transcript alignment)
- Live licensed farm tests
- 26.3 HTML Help tree still 503 at research time
