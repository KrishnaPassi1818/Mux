#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:8080}"
export BASE_URL
"$SCRIPT_DIR/mock-smoke.sh"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
docker compose -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/deploy/docker-compose.mock-router.yml" exec -T gateway node -e "fetch('http://127.0.0.1:3000/metrics').then(async r=>{if(!r.ok)process.exit(1);const body=await r.text();if(!body.includes('http_requests_total'))process.exit(1)}).catch(()=>process.exit(1))"
echo 'PASS internal gateway /metrics'
