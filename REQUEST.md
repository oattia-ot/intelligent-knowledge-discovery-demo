# Consolidated request (source spec)

This file records the merge spec that the Intelligent Knowledge Discovery Demo implements.

Merge the two project ZIP files (`kd-sandbox-ai-demo` and `kd-nifi-ai-mcp`)
into a single unified package, with the following requirements:

## 1. Folder structure

- Create a top-level demo package containing the merged contents of both projects.
- Preserve each project's internal structure so both can still be built and run independently.

## 2. Cleanup script

- Add a `cleanup.sh` script at the package root.
- It should remove temporary files created while running
  `kd-sandbox-ai-demo` and `kd-nifi-ai-mcp` (build artifacts, caches, logs,
  temp containers/volumes, and similar files).

## 3. Deployment flow

- On deploy, prompt the user to choose what to start:
  - `kd-sandbox-ai-demo` — required, always deployed.
  - `kd-nifi-ai-mcp` — optional.

## 4. Conditional UI behavior

- If `kd-nifi-ai-mcp` is deployed, show the "NiFi AI" button in the UI.
- If it is not deployed, hide the "NiFi AI" button.
- The "NiFi AI" UI must open as a popup/modal inside `http://localhost:4200` —
  it must not navigate to a separate route and must not open a new browser tab.
  Clicking the button opens an in-page overlay on the current page
  (for example `http://localhost:4200/home`). The overlay should match the
  parent app look and feel (header color, fonts, borders, shadows, and theme).

## 5. External NiFi support

- Allow an existing external NiFi URL instead of deploying NiFi locally.
- Keep that configuration in a separate Docker Compose project name so it
  does not conflict with the local `kd-nifi-ai-mcp` stack.

## 6. Undeployment options

- In addition to `cleanup.sh` (which wipes caches and artifacts), provide a
  way to stop running services (dev server, local NiFi stack, external NiFi
  stack) without deleting caches, so the next deploy is fast. Support stopping
  components independently (search UI only, NiFi only, local vs. external NiFi,
  or everything).

## Deliverables

- Unified Intelligent Knowledge Discovery Demo package with both projects merged.
- `cleanup.sh` at the root (destructive — wipes caches/artifacts).
- An undeploy script at the root (non-destructive — stops services, keeps caches).
- Deployment script (`install.sh`) that handles the required/optional selection above.
- Docker Compose setup(s) for local vs. external NiFi as separate compose projects.
- Colored output on setup scripts shown to the user.
- A short guide on how to run `install.sh`.

See `README.md` for the operator guide.
