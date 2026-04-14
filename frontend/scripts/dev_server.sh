#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOST="${VITE_HOST:-0.0.0.0}"

cd "${ROOT_DIR}"

if [[ -n "${VITE_PORT:-}" ]]; then
  exec npx vite --host "${DEV_HOST}" --port "${VITE_PORT}"
fi

exec npx vite --host "${DEV_HOST}"
