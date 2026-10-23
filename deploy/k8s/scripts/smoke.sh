#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8080}"
NAMESPACE="${NAMESPACE:-llm-router}"

check() {
  local path="$1"
  local status
  status="$(curl --silent --show-error --output /tmp/llm-router-smoke-body --write-out '%{http_code}' "$BASE_URL$path")"
  if [[ "$status" != "200" ]]; then
    echo "FAIL $path (HTTP $status)" >&2
    cat /tmp/llm-router-smoke-body >&2 || true
    exit 1
  fi
  echo "PASS $path"
}

check /api/health
check /api/models
check /api/stats
kubectl -n "$NAMESPACE" exec deployment/gateway -- node -e "fetch('http://127.0.0.1:3000/metrics').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
echo 'PASS internal gateway /metrics'
