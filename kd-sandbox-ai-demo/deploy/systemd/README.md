# systemd service — Intelligent Knowledge Discovery Demo

Runs `apps/web/serve.sh` (Node check → sync-config → `ng serve` on `0.0.0.0:4200`) as a managed service.

## Files

| File | Role |
|------|------|
| `kd-enterprise-search.service` | systemd unit (legacy unit filename shipped with the scripts) |
| `kd-enterprise-search.env` | Env template written to `/etc/default/kd-enterprise-search` (legacy name used by install-service.sh) |
| `install-service.sh` | Installs unit + env, enables and starts the service |

## Install

```bash
cd kd-sandbox-ai-demo/apps/web
npm install          # once
cd ../../deploy/systemd
sudo ./install-service.sh /path/to/kd-sandbox-ai-demo
```

Or with default path detection (repo root = parent of `deploy/`):

```bash
sudo ./install-service.sh
```

## Operations

```bash
sudo systemctl status kd-enterprise-search
sudo journalctl -u kd-enterprise-search -f    # live logs
sudo systemctl restart kd-enterprise-search
sudo systemctl stop kd-enterprise-search
sudo systemctl disable kd-enterprise-search   # no start on boot
```

## Notes

- **Node 22** is required. For nvm, set `NODE_BIN_DIR` in `/etc/default/kd-enterprise-search` to something like  
  `/home/ubuntu/.nvm/versions/node/v22.14.0/bin`.
- Change `User=` / `Group=` in the unit if your app is not owned by `ubuntu`.
- This is a **dev** server (`ng serve`), not a production static host. For production use Nginx + `ng build` output.
- Proxy logs from `serve.sh` appear in the journal (`journalctl -u kd-enterprise-search -f`).
