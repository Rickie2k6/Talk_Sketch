#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${HOST:-127.0.0.1}"
SERVER_PORT="${PORT:-3001}"

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

if is_port_listening "${SERVER_PORT}"; then
  echo "Talk Sketch backend is already running at http://${SERVER_HOST}:${SERVER_PORT}"
  exit 0
fi

if [[ -z "${PIX2TEXT_PYTHON_BIN:-}" && -z "${MATH_OCR_PYTHON_BIN:-}" ]] && command -v conda >/dev/null 2>&1; then
  CONDA_BASE="$(conda info --base 2>/dev/null || true)"
  RESOLVED_PYTHON=""

  if [[ -n "${CONDA_BASE}" ]]; then
    CANDIDATE_PYTHON="${CONDA_BASE}/envs/talk_sketch/bin/python"
    if [[ -x "${CANDIDATE_PYTHON}" ]]; then
      RESOLVED_PYTHON="${CANDIDATE_PYTHON}"
    fi
  fi

  if [[ -n "${RESOLVED_PYTHON}" && -x "${RESOLVED_PYTHON}" ]]; then
    export PIX2TEXT_PYTHON_BIN="${RESOLVED_PYTHON}"
  fi
fi

exec node "${ROOT_DIR}/server.js"
