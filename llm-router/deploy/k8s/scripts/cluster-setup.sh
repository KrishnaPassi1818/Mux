#!/usr/bin/env bash
set -euo pipefail

CLUSTER_KIND="${1:-k3d}"
CLUSTER_NAME="${K3D_CLUSTER:-llm-router}"

case "$CLUSTER_KIND" in
  k3d)
    command -v k3d >/dev/null || { echo 'Install k3d and Docker first: https://k3d.io/' >&2; exit 1; }
    if ! k3d cluster list | awk 'NR>1 {print $1}' | grep -Fxq "$CLUSTER_NAME"; then
      k3d cluster create "$CLUSTER_NAME" --servers 1 --agents 1 --wait
    fi
    k3d kubeconfig merge "$CLUSTER_NAME" --kubeconfig-switch-context
    ;;
  minikube)
    command -v minikube >/dev/null || { echo 'Install minikube and a supported driver first: https://minikube.sigs.k8s.io/' >&2; exit 1; }
    minikube start --profile "$CLUSTER_NAME" --cpus 4 --memory 6144
    kubectl config use-context "$CLUSTER_NAME"
    ;;
  *)
    echo "Usage: $0 [k3d|minikube]" >&2
    exit 2
    ;;
esac

kubectl cluster-info
kubectl get nodes -o wide
echo 'Local Kubernetes cluster is ready.'
