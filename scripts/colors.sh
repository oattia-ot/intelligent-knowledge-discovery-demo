#!/usr/bin/env bash
# Shared ANSI colors for kd-demo setup scripts.
# Disable with NO_COLOR=1 or when stdout is not a TTY.

if [[ -n "${NO_COLOR:-}" || ! -t 1 ]]; then
  C_RESET="" C_BOLD="" C_DIM=""
  C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_MAGENTA="" C_CYAN="" C_WHITE=""
else
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_MAGENTA=$'\033[35m'
  C_CYAN=$'\033[36m'
  C_WHITE=$'\033[37m'
fi

kd_info()    { printf '%s%sℹ%s  %s\n' "$C_CYAN" "$C_BOLD" "$C_RESET" "$*"; }
kd_ok()      { printf '%s%s✓%s  %s\n' "$C_GREEN" "$C_BOLD" "$C_RESET" "$*"; }
kd_warn()    { printf '%s%s!%s  %s\n' "$C_YELLOW" "$C_BOLD" "$C_RESET" "$*"; }
kd_err()     { printf '%s%s✗%s  %s\n' "$C_RED" "$C_BOLD" "$C_RESET" "$*" >&2; }
kd_step()    { printf '\n%s%s▸ %s%s\n' "$C_MAGENTA" "$C_BOLD" "$*" "$C_RESET"; }
kd_banner() {
  printf '\n%s%s╔══════════════════════════════════════════════════════════╗%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
  printf '%s%s║  %-56s║%s\n' "$C_CYAN" "$C_BOLD" "$1" "$C_RESET"
  printf '%s%s╚══════════════════════════════════════════════════════════╝%s\n\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
}
kd_ask() {
  local prompt="$1" default="${2:-}"
  local suffix=""
  if [[ -n "$default" ]]; then
    suffix=" ${C_DIM}[${default}]${C_RESET}"
  fi
  printf '%s?%s  %s%s ' "$C_YELLOW" "$C_RESET" "$prompt" "$suffix" >&2
  local reply=""
  if [[ -t 0 ]]; then
    read -r reply || true
  else
    printf '\n' >&2
  fi
  if [[ -z "$reply" ]]; then
    reply="$default"
  fi
  printf '%s' "$reply"
}
kd_confirm() {
  local prompt="$1" default="${2:-n}"
  local reply
  reply="$(kd_ask "$prompt (y/n)" "$default")"
  case "${reply,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}
