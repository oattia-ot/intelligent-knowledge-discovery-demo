# IDOL 26.3 GetFileSystem → PutIDOL

Create the 26.3.0-nifi2 sample that watches a filesystem and indexes
into IDOL Content (`GetFileSystem` → `PutIDOL`).

Catalog id: `idol-nifi2-26.3`.  
Prompt: *Create a 26.3.0-nifi2 GetFileSystem PutIDOL sample*.

## Before you start

- NiFi AI is enabled and **Connection → Test** succeeds.
- The NiFi host can resolve the IDOL Content container (typical
  compose name `idol-content` on `idol-demo-network`, ACI port `9100`).
- Drop files into the ingest volume that NiFi mounts (IDOL demo:
  `idol-ingest-volume` → `/idol-ingest`).

## Steps

1. Sign in and open header **NiFi AI**.
2. In the sidebar **Templates** list, click
   **26.3 GetFileSystem → PutIDOL**.
3. Wait for the assistant plan. Activity log should show processor
   create / config / connect calls.
4. In the NiFi UI, open the new process group.
5. Check `GetFileSystem` (or equivalent) **Input Directory** —
   default sample path is `/idol-ingest`.
6. Check `PutIDOL` host/port against your Content component.
7. Start the processors in the group (`start_all_processors_in_group`
   from chat, or Start in NiFi).
8. Copy a small `.txt` or `.pdf` into the ingest folder and confirm a
   new document in Find / the search UI.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| Overlay Unauthorized / NiFi `#/error` | Publish `27111:8443`, list `HOST:27111` in `NIFI_WEB_PROXY_HOST`, allow context paths `/nifi,/idol-nifi`. Use **https://**. See `compose/idol-demo/README.md`. |
| Processors unknown | Image must include IDOL 26.3 NiFi 2 NAR/processors (`GetFileSystem`, `PutIDOL`). |
| Nothing indexed | Directory empty, processor stopped, or Content host unreachable from the NiFi container. |

## Next

- [AI test with Python](./nifi-ai-python.md)
- [Document query guidance](./document-query-guidance.md)
