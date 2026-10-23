#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env
fi

echo "==========================================================="
echo " Starting LLM Router Stack with Mock Backend (Fast Local Dev)"
echo "==========================================================="
echo "Services:"
echo " - Mock Router: http://localhost:8081"
echo " - Gateway:     http://localhost:3000"
echo " - Frontend:    http://localhost:5173"
echo "==========================================================="

exec npm run dev:mock
