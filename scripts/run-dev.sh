#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example..."
  cp .env.example .env
fi

# Check if redis is accessible on 6379
if ! nc -z 127.0.0.1 6379 2>/dev/null; then
  echo "==> Redis is not running on 127.0.0.1:6379."
  if command -v docker >/dev/null 2>&1; then
    echo "==> Starting Redis via docker compose..."
    docker compose up -d redis
  else
    echo "==> Warning: Docker not found. Router will start in cache-bypass mode."
  fi
fi

# Check Ollama connection
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "==> Note: Ollama is not responding on http://127.0.0.1:11434."
  echo "    Ensure 'ollama serve' is running if you want real model inference,"
  echo "    or use './scripts/run-mock.sh' to test without local LLM weights."
fi

echo "==========================================================="
echo " Starting Full LLM Router Stack (Rust Router + Gateway + Frontend)"
echo "==========================================================="
echo "Services:"
echo " - Router (Rust): http://localhost:8081"
echo " - Gateway (Node):http://localhost:3000"
echo " - Frontend (Vite):http://localhost:5173"
echo "==========================================================="

exec npm run dev
