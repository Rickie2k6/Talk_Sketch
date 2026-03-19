#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOST="${VITE_HOST:-127.0.0.1}"
DEV_PORT="${VITE_PORT:-5174}"

is_port_listening() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" | tail -n +2 | grep -q .
    return $?
  fi

  return 1
}

if is_port_listening "${DEV_PORT}"; then
  echo "Talk Sketch frontend is already running at http://${DEV_HOST}:${DEV_PORT}"
  exit 0
fi

cd "${ROOT_DIR}"
exec npx vite --host "${DEV_HOST}" --port "${DEV_PORT}" --strictPort
