#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_HOST="${HOST:-0.0.0.0}"
MIN_PORT=8080
MAX_PORT=8900

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

validate_port() {
  local port="$1"

  [[ "${port}" =~ ^[0-9]+$ ]] || return 1
  (( port >= MIN_PORT && port <= MAX_PORT ))
}

find_available_port() {
  local port

  for ((port=MIN_PORT; port<=MAX_PORT; port+=1)); do
    if ! is_port_listening "${port}"; then
      echo "${port}"
      return 0
    fi
  done

  return 1
}

if [[ -n "${PORT:-}" ]]; then
  if ! validate_port "${PORT}"; then
    echo "PORT must be between ${MIN_PORT} and ${MAX_PORT}."
    exit 1
  fi

  SERVER_PORT="${PORT}"
  if is_port_listening "${SERVER_PORT}"; then
    echo "Port ${SERVER_PORT} is already in use. Choose another port in ${MIN_PORT}-${MAX_PORT}."
    exit 1
  fi
else
  SERVER_PORT="$(find_available_port)" || {
    echo "No available port found in ${MIN_PORT}-${MAX_PORT}."
    exit 1
  }
fi

export HOST="${SERVER_HOST}"
export PORT="${SERVER_PORT}"

if [[ -z "${COMER_PYTHON_BIN:-}" && -z "${PIX2TEXT_PYTHON_BIN:-}" && -z "${MATH_OCR_PYTHON_BIN:-}" ]] && command -v conda >/dev/null 2>&1; then
  CONDA_BASE="$(conda info --base 2>/dev/null || true)"
  RESOLVED_PYTHON=""

  if [[ -n "${CONDA_BASE}" ]]; then
    CANDIDATE_PYTHON="${CONDA_BASE}/envs/talk_sketch/bin/python"
    if [[ -x "${CANDIDATE_PYTHON}" ]]; then
      RESOLVED_PYTHON="${CANDIDATE_PYTHON}"
    fi
  fi

  if [[ -n "${RESOLVED_PYTHON}" && -x "${RESOLVED_PYTHON}" ]]; then
    export COMER_PYTHON_BIN="${RESOLVED_PYTHON}"
  fi
fi

echo "Talk Sketch backend starting on http://${SERVER_HOST}:${SERVER_PORT}"
exec node "${ROOT_DIR}/server.js"
