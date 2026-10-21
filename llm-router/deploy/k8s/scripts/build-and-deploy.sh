#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OVERLAY="${K8S_OVERLAY:-dev}"
CLUSTER_KIND="${CLUSTER_KIND:-k3d}"
CLUSTER_NAME="${K3D_CLUSTER:-llm-router}"

cd "$ROOT"
for target in router gateway frontend mock-ollama; do
  case "$target" in
    router) docker build -f deploy/docker/router.Dockerfile -t llm-router/router:local . ;;
    gateway) docker build -f deploy/docker/gateway.Dockerfile -t llm-router/gateway:local . ;;
    frontend) docker build -f deploy/docker/frontend.Dockerfile -t llm-router/frontend:local . ;;
    mock-ollama) docker build -f tools/mock-ollama/Dockerfile -t llm-router/mock-ollama:local . ;;
  esac
done

case "$CLUSTER_KIND" in
  k3d) k3d image import llm-router/router:local llm-router/gateway:local llm-router/frontend:local llm-router/mock-ollama:local -c "$CLUSTER_NAME" ;;
  kind) kind load docker-image llm-router/router:local llm-router/gateway:local llm-router/frontend:local llm-router/mock-ollama:local --name "$CLUSTER_NAME" ;;
  minikube) minikube image load llm-router/router:local llm-router/gateway:local llm-router/frontend:local llm-router/mock-ollama:local -p "$CLUSTER_NAME" ;;
  *) echo "Unknown CLUSTER_KIND=$CLUSTER_KIND (use k3d, kind, or minikube)." >&2; exit 2 ;;
esac

kubectl apply -k "deploy/k8s/overlays/$OVERLAY"
kubectl -n llm-router rollout status deployment/mock-ollama --timeout=180s
kubectl -n llm-router rollout status deployment/router --timeout=180s
kubectl -n llm-router rollout status deployment/gateway --timeout=180s
kubectl -n llm-router rollout status deployment/frontend --timeout=180s

echo 'Deployment is ready. Run deploy/k8s/scripts/port-forward.sh and open http://localhost:8080.'
