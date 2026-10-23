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
echo " Starting LLM Router Stack with Docker Compose"
echo "==========================================================="
echo "Frontend will be available at: http://localhost:8080"
echo "Observability (Prometheus/Grafana) can be enabled with deploy/docker-compose.observability.yml"
echo "==========================================================="

docker compose up --build -d

echo ""
echo "Stack started in background. View logs with: docker compose logs -f"
