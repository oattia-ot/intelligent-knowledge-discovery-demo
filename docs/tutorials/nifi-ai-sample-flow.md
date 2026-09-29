# Create a sample NiFi flow

Build a tiny GenerateFlowFile → LogAttribute process group through the
NiFi AI overlay. Needs NiFi AI deployed (`./install.sh` option 1 or 2)
and a reachable NiFi API.

## Steps

1. Sign in at **http://localhost:4200**.
2. Click the header **NiFi AI** pill. An overlay opens on the current
   page; the URL does not change and no new tab opens.
3. On the left, under **Actions** / **Templates**, click **Sample flow**
   (prompt: *Create a sample NiFi flow*).
   You can also type that sentence and click **Send**.
4. Watch the thread and the bottom **Activity log** for the orchestrator
   calls (`start_new_flow`, `create_processor`, `create_connection`).
5. Optional: click **Connection** in the overlay header, then **Test**,
   to confirm token + `/nifi-api/flow/about`.
6. Open NiFi itself (`https://HOST:27111/nifi` or your IDOL URL) and
   find the new process group on the canvas.

## If the overlay button is missing

`kd-sandbox-ai-demo/config/nifi-ai.json` must have `"enabled": true`.
`./install.sh --nifi none` writes `false` and hides the pill.

## Next

- [IDOL 26.3 GetFileSystem → PutIDOL](./nifi-ai-idol-26.3-getfilesystem-putidol.md)
- [AI test with Python](./nifi-ai-python.md)
