#!/usr/bin/env bash
set -euo pipefail
NAMESPACE="${K8S_NAMESPACE:-llm-router}"
LOCAL_PORT="${FRONTEND_PORT:-8080}"
REMOTE_PORT="${FRONTEND_SERVICE_PORT:-80}"
exec kubectl -n "$NAMESPACE" port-forward "service/frontend" "$LOCAL_PORT:$REMOTE_PORT"
