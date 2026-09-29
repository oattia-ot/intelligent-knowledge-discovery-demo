#!/usr/bin/env bash
# Refuse to run application deploy/start/build on a Windows-native client.
# WSL, Linux, and other server-side environments are the only supported runtime.

require_server_runtime() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"

  if [[ -r /proc/version ]] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    return 0
  fi

  case "$uname_s" in
    Linux|Darwin|FreeBSD)
      return 0
      ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
      echo "ERROR: This application must be deployed and run on the SERVER (Linux / Ubuntu / WSL / VM / Docker host)." >&2
      echo "Windows is a client only. Do not start Node, npm, Angular CLI, Docker, NiFi, IDOL, or Ollama from PowerShell, CMD, or Git Bash." >&2
      echo "From Windows use a browser against the server URL, or open this repo in WSL / SSH and run ./install.sh there." >&2
      return 1
      ;;
  esac

  if [[ "${OS:-}" == "Windows_NT" ]]; then
    echo "ERROR: Windows-native runtime detected. Deploy on Linux/WSL/server instead." >&2
    return 1
  fi

  return 0
}

print_runtime_banner() {
  local host
  host="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo server)"
  echo "[runtime] server-side host=${host} uname=$(uname -s) pwd=$(pwd)"
}
