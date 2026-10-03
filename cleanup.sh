#!/usr/bin/env bash
# Full cleanup for kd-demo: build artifacts, caches, logs, runtime state, and
# every Docker resource this application created — containers, images,
# orphaned compose resources, and (opt-in) volumes.
#
# Safe for all three NiFi AI deployment modes:
#   - No NiFi AI            (nothing docker-related was ever created)
#   - Local kd-nifi-ai-mcp  (compose project "kd-nifi-ai-mcp")
#   - External NiFi URL     (compose project "kd-nifi-ai-mcp-ext")
#
# Identification is label/name based (Docker Compose project labels, compose
# project names, and the application's own image-name prefixes) — never
# hardcoded container names alone. Resources belonging to other
# applications, and the shared external "idol-demo-network" Docker network,
# are never touched.
#
# This does NOT only stop processes — use ./undeploy.sh for that (this
# script calls it first so nothing is removed while still running).
#
# Usage:
#   ./cleanup.sh              # artifacts + caches + logs + containers/images
#   ./cleanup.sh --volumes    # also remove app-specific Docker volumes
#   ./cleanup.sh --deep       # also delete package-lock.json
#   ./cleanup.sh --dry-run    # print what would be removed; remove nothing
#
# Exit code is always 0 on a normal (non-dry-run) pass, including when there
# is nothing to clean — this script is safe to run repeatedly and in CI.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/colors.sh
source "$ROOT/scripts/colors.sh"
# shellcheck source=scripts/require-server-runtime.sh
source "$ROOT/scripts/require-server-runtime.sh"
require_server_runtime || exit 1

SANDBOX_DIR="$ROOT/kd-sandbox-ai-demo"
NIFI_DIR="$ROOT/kd-nifi-ai-mcp"
RUN_DIR="$ROOT/.run"
STATE_FILE="$RUN_DIR/state"
COMPOSE_FILE="$NIFI_DIR/docker-compose.yml"

# Compose project names used by the two Docker-based deployment modes.
# (See install.sh write_state NIFI_COMPOSE_PROJECT / undeploy.sh.)
KNOWN_PROJECTS=(kd-nifi-ai-mcp kd-nifi-ai-mcp-ext)

# Image-name prefixes this application is known to build or tag. Matched
# case-insensitively against the repository name (not the registry/tag).
# Deliberately broad per the cleanup spec ("kd-nifi-ai-*", "kd-demo*",
# "kd-sandbox-ai-demo*") so orphaned images are still found even if a
# container/compose label is missing.
IMAGE_NAME_PATTERNS=(
  '^kd-nifi-ai-mcp(-ext)?-'
  '^kd-nifi-ai-'
  '^kd-nifi-ai$'
  '^kd-demo'
  '^kd-sandbox-ai-demo'
)

# Images that are pulled from a public/shared registry rather than built by
# this application. These must never be removed by name-pattern matching —
# only an exact compose-project-label match on a *container* using them
# would ever be relevant, and even then we only remove the container, not
# the shared base image (other deployments / other apps may reuse it).
PROTECTED_IMAGE_PATTERNS=(
  '^microfocusidolserver/'
  '^ollama/ollama'
)

# Docker networks this application never owns and must never remove, even
# if a local deployment created it (NIFI_DOCKER_NETWORK_EXTERNAL=false).
# It is shared by compose/idol-demo, compose/idol-docker-setup and this
# app's kd-nifi-ai-mcp/docker-compose.yml (declared `external: true`).
PROTECTED_NETWORKS=(idol-demo-network)

DEEP=0
DRY=0
VOLUMES=0
HAVE_DOCKER=0

usage() { sed -n '2,20p' "$0"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deep) DEEP=1; shift ;;
    --volumes|--docker) VOLUMES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) kd_err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  HAVE_DOCKER=1
fi

run() {
  # run <command...>
  # Executes (or, on --dry-run, only prints) a possibly-failing cleanup
  # command. Never aborts the script — every resource is independent.
  if [[ "$DRY" -eq 1 ]]; then
    kd_warn "Would run: $*"
    return 0
  fi
  local out
  if ! out="$("$@" 2>&1)"; then
    kd_warn "  (non-fatal) failed: $* — $(printf '%s' "$out" | tail -n1)"
  fi
  return 0
}

rm_path() {
  local path="$1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return
  fi
  if [[ "$DRY" -eq 1 ]]; then
    kd_warn "Would remove $path"
  else
    kd_info "Removing $path"
    rm -rf -- "$path"
  fi
}

matches_any_pattern() {
  # matches_any_pattern <value> <pattern...>
  local value="$1"; shift
  local pattern
  for pattern in "$@"; do
    if [[ "$value" =~ $pattern ]]; then
      return 0
    fi
  done
  return 1
}

is_protected_image() {
  matches_any_pattern "$(tr '[:upper:]' '[:lower:]' <<<"$1")" "${PROTECTED_IMAGE_PATTERNS[@]}"
}

is_app_image_name() {
  matches_any_pattern "$(tr '[:upper:]' '[:lower:]' <<<"$1")" "${IMAGE_NAME_PATTERNS[@]}"
}

is_protected_network() {
  local name="$1" p
  for p in "${PROTECTED_NETWORKS[@]}"; do
    [[ "$name" == "$p" ]] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Docker Compose project discovery
# ---------------------------------------------------------------------------

# All compose project names we should look for, deduped: the two known
# project names, plus whatever the last install recorded in .run/state (in
# case a custom COMPOSE_PROJECT_NAME was used) and the live env var if set.
discover_projects() {
  local -A seen=()
  local list=()
  local p
  for p in "${KNOWN_PROJECTS[@]}"; do
    if [[ -z "${seen[$p]:-}" ]]; then seen[$p]=1; list+=("$p"); fi
  done
  if [[ -f "$STATE_FILE" ]]; then
    p="$(awk -F= '/^NIFI_COMPOSE_PROJECT=/{print $2}' "$STATE_FILE" 2>/dev/null | tail -n1)"
    if [[ -n "$p" && -z "${seen[$p]:-}" ]]; then seen[$p]=1; list+=("$p"); fi
  fi
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" && -z "${seen[$COMPOSE_PROJECT_NAME]:-}" ]]; then
    list+=("$COMPOSE_PROJECT_NAME")
  fi
  printf '%s\n' "${list[@]}"
}

project_containers() {
  # All containers (running or stopped) labeled with this compose project.
  docker ps -a --filter "label=com.docker.compose.project=$1" --format '{{.ID}}' 2>/dev/null
}

project_images_by_label() {
  docker images --filter "label=com.docker.compose.project=$1" --format '{{.ID}}\t{{.Repository}}' 2>/dev/null
}

all_images_by_name_pattern() {
  docker images --format '{{.ID}}\t{{.Repository}}' 2>/dev/null
}

network_container_count() {
  docker network inspect "$1" --format '{{len .Containers}}' 2>/dev/null || echo 0
}

# ---------------------------------------------------------------------------
# Docker cleanup for a single compose project (covers local + external-NiFi
# modes; a no-op for a project that was never deployed).
# ---------------------------------------------------------------------------
cleanup_project_docker() {
  local project="$1"
  local removed_any=0

  local containers
  containers="$(project_containers "$project")"
  if [[ -n "$containers" ]]; then
    kd_step "Docker containers — project '$project'"
    local cid name
    while read -r cid; do
      [[ -z "$cid" ]] && continue
      name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')"
      kd_info "Stopping + removing container ${name:-$cid}"
      run docker rm -f "$cid"
      removed_any=1
    done <<<"$containers"
  fi

  # Compose's default project network, if this project created one (it is
  # only created when NIFI_DOCKER_NETWORK_EXTERNAL=false; by default the
  # stack attaches to the pre-existing, protected idol-demo-network).
  local candidate_networks=()
  local net
  for net in "${project}_default" "${project}-default" "${project}_nifi-ext" "${project}-nifi-ext"; do
    if docker network inspect "$net" >/dev/null 2>&1; then
      candidate_networks+=("$net")
    fi
  done
  if [[ ${#candidate_networks[@]} -gt 0 ]]; then
    kd_step "Docker networks — project '$project'"
    for net in "${candidate_networks[@]}"; do
      if is_protected_network "$net"; then
        kd_warn "Skipping shared/external network '$net' (not owned by this project)"
        continue
      fi
      local in_use
      in_use="$(network_container_count "$net")"
      if [[ "${in_use:-0}" != "0" ]]; then
        kd_warn "Skipping network '$net' — still has $in_use attached container(s)"
        continue
      fi
      kd_info "Removing orphaned network $net"
      run docker network rm "$net"
      removed_any=1
    done
  fi

  local images
  images="$(project_images_by_label "$project")"
  if [[ -n "$images" ]]; then
    kd_step "Docker images (compose-labeled) — project '$project'"
    local iid repo
    while IFS=$'\t' read -r iid repo; do
      [[ -z "$iid" ]] && continue
      if is_protected_image "$repo"; then
        kd_warn "Skipping shared base image $repo ($iid)"
        continue
      fi
      kd_info "Removing image $repo ($iid)"
      run docker rmi -f "$iid"
      removed_any=1
    done <<<"$images"
  fi

  if [[ "$VOLUMES" -eq 1 ]]; then
    local vols
    vols="$(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}' 2>/dev/null)"
    if [[ -n "$vols" ]]; then
      kd_step "Docker volumes — project '$project'"
      local v
      while read -r v; do
        [[ -z "$v" ]] && continue
        kd_info "Removing volume $v"
        run docker volume rm "$v"
        removed_any=1
      done <<<"$vols"
    fi
    if [[ -f "$COMPOSE_FILE" ]]; then
      local env_args=()
      [[ -f "$NIFI_DIR/.env" ]] && env_args+=(--env-file "$NIFI_DIR/.env")
      run docker compose -p "$project" "${env_args[@]}" -f "$COMPOSE_FILE" down -v --remove-orphans
    fi
  else
    # Clear any orphaned (renamed/removed service) containers compose still
    # knows about, without touching named volumes.
    if [[ -f "$COMPOSE_FILE" ]]; then
      local env_args=()
      [[ -f "$NIFI_DIR/.env" ]] && env_args+=(--env-file "$NIFI_DIR/.env")
      run docker compose -p "$project" "${env_args[@]}" -f "$COMPOSE_FILE" down --remove-orphans
    fi
  fi

  if [[ "$removed_any" -eq 0 ]]; then
    kd_info "Project '$project': nothing to clean"
  fi
}

# Catch-all sweep for app-named images that survived the per-project pass
# (e.g. a build that was never labeled, or a project name that changed).
cleanup_orphan_app_images() {
  kd_step "Docker images (name-pattern sweep)"
  local found=0
  local iid repo
  while IFS=$'\t' read -r iid repo; do
    [[ -z "$iid" || "$repo" == "<none>" ]] && continue
    if is_protected_image "$repo"; then
      continue
    fi
    if is_app_image_name "$repo"; then
      kd_info "Removing orphaned image $repo ($iid)"
      run docker rmi -f "$iid"
      found=1
    fi
  done <<<"$(all_images_by_name_pattern)"
  if [[ "$found" -eq 0 ]]; then
    kd_info "No orphaned application images found"
  fi
}

# Dangling (untagged) build layers left behind by rebuilds. Scoped to
# untagged/<none> images only — never a blanket prune of tagged images
# belonging to other applications on the same host.
cleanup_dangling_build_layers() {
  local dangling
  dangling="$(docker images --filter 'dangling=true' --format '{{.ID}}' 2>/dev/null)"
  [[ -z "$dangling" ]] && return
  kd_step "Dangling build layers"
  local iid
  while read -r iid; do
    [[ -z "$iid" ]] && continue
    kd_info "Removing dangling layer $iid"
    run docker rmi -f "$iid"
  done <<<"$dangling"
}

# ---------------------------------------------------------------------------

kd_banner "kd-demo  cleanup"

# Stop first so files/containers are not busy.
if [[ "$DRY" -eq 0 && -x "$ROOT/undeploy.sh" ]]; then
  kd_step "Stopping running services first"
  bash "$ROOT/undeploy.sh" --all || true
elif [[ "$DRY" -eq 1 ]]; then
  kd_warn "Would run: $ROOT/undeploy.sh --all"
fi

kd_step "Sandbox artifacts"
rm_path "$SANDBOX_DIR/apps/web/node_modules"
rm_path "$SANDBOX_DIR/apps/web/dist"
rm_path "$SANDBOX_DIR/apps/web/.angular"
rm_path "$SANDBOX_DIR/apps/web/coverage"
rm_path "$SANDBOX_DIR/apps/web/.nx-cache"
shopt -s nullglob
for f in "$SANDBOX_DIR/apps/web"/npm-debug.log*; do
  rm_path "$f"
done
shopt -u nullglob
if [[ "$DEEP" -eq 1 ]]; then
  rm_path "$SANDBOX_DIR/apps/web/package-lock.json"
fi

kd_step "NiFi AI artifacts"
rm_path "$NIFI_DIR/.env"
rm_path "$NIFI_DIR/ports.json"
find "$NIFI_DIR" -type d -name '__pycache__' -prune -print 2>/dev/null | while read -r d; do
  rm_path "$d"
done
find "$NIFI_DIR" -type f \( -name '*.pyc' -o -name '.DS_Store' \) -print 2>/dev/null | while read -r f; do
  rm_path "$f"
done

kd_step "Demo runtime files"
rm_path "$ROOT/.run/sandbox.log"
rm_path "$ROOT/.run/sandbox.pid"
# Keep state file unless dry-run? Wipe it — it describes a live deploy.
rm_path "$ROOT/.run/state"

# Reset the UI flag so a leftover enabled:true cannot show a dead button.
if [[ "$DRY" -eq 0 ]]; then
  python3 - "$SANDBOX_DIR/config/nifi-ai.json" "$SANDBOX_DIR/apps/web/src/assets/config/nifi-ai.json" <<'PY'
import json, sys, pathlib
doc = {
    "enabled": False,
    "mode": "none",
    "uiUrl": "/nifi-ai/?theme=fta",
    "directUiUrl": "http://localhost:27120/?theme=fta",
    "orchestratorUrl": "http://localhost:27110",
}
for p in sys.argv[1:]:
    path = pathlib.Path(p)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2) + "\n")
PY
  kd_ok "Reset nifi-ai.json (button hidden)"
else
  kd_warn "Would reset nifi-ai.json (button hidden)"
fi

# ---------------------------------------------------------------------------
# Docker resources — covers all three deployment modes. A project that was
# never deployed simply yields "nothing to clean"; this is always safe to
# run, including on a machine with no Docker installed/running at all.
# ---------------------------------------------------------------------------
if [[ "$HAVE_DOCKER" -eq 1 ]]; then
  kd_step "Docker resources (containers, images, orphaned compose state)"
  while read -r project; do
    [[ -z "$project" ]] && continue
    cleanup_project_docker "$project"
  done <<<"$(discover_projects)"

  cleanup_orphan_app_images
  cleanup_dangling_build_layers
elif [[ "$DRY" -eq 1 ]]; then
  kd_warn "Docker not available in this environment — would skip Docker cleanup"
else
  kd_info "Docker not available or not running — skipping Docker cleanup (nothing to clean)"
fi

echo
if [[ "$DRY" -eq 1 ]]; then
  kd_ok "Dry run complete"
else
  kd_ok "Cleanup complete"
  kd_info "Reinstall sandbox deps with:  cd kd-sandbox-ai-demo/apps/web && npm install --include=dev"
  kd_info "Redeploy with:                ./install.sh"
fi
echo

exit 0
