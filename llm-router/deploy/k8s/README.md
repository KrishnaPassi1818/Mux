# Kubernetes / local cluster

The base manifests run the Rust router, TypeScript gateway, static React UI, Redis, an Ollama `ExternalName`, a persistent benchmark-results volume, ingress, and a gateway HPA. Pods run non-root with read-only root filesystems, dropped Linux capabilities, resource requests/limits, and health probes. Router and Redis are not exposed outside the namespace.

## Requirements

- Docker plus `kubectl` and one of k3d, kind, or minikube.
- Rust toolchain for the router image build (or use CI to publish it).
- A StorageClass that can provide `ReadWriteOnce` PVCs for Redis and benchmark results.
- Ollama running on the cluster host with the configured models for real inference. The dev overlay instead deploys the deterministic mock Ollama service.

## Mock deployment (recommended first)

```bash
deploy/k8s/scripts/cluster-setup.sh k3d
CLUSTER_KIND=k3d K3D_CLUSTER=llm-router deploy/k8s/scripts/build-and-deploy.sh
# In another terminal:
deploy/k8s/scripts/port-forward.sh
# Open http://localhost:8080
deploy/k8s/scripts/smoke.sh
```

For kind, set `CLUSTER_KIND=kind`; for minikube, set `CLUSTER_KIND=minikube`. Set `K3D_CLUSTER` to your cluster name. The dev overlay uses the in-cluster `mock-ollama` deployment, so no GPU or model download is needed. It is deterministic smoke-test infrastructure, not a performance backend.

## Real Ollama on the host

Build the `router`, `gateway`, and `frontend` images and apply the base manifests or make a production overlay from `base`. The base `ollama` service points at `host.k3d.internal`; patch `deploy/k8s/base/ollama-externalname.yaml` to `host.minikube.internal` for Minikube, or to a DNS name reachable from the pods. If the host cannot be represented as an `ExternalName`, replace that Service with a ClusterIP Service and explicit Endpoints/EndpointSlices. Set `OLLAMA_URL` to the Service DNS name and confirm the model tags match `config/models.yaml`.

The default ingress expects an NGINX ingress controller and host `llm-router.local`; add that host to your local hosts file and install an ingress controller, or use the port-forward script instead. The HPA needs Metrics Server; without it the static one-replica deployment still works.

## Storage and scaling notes

Redis data and benchmark JSON use separate PVCs. This local deployment is intentionally single-router: its in-memory scheduling/model warm-state is not distributed. The gateway HPA is an example and uses shared benchmark-results storage; production storage must support the selected access mode or the HPA should be disabled. Model inference and GPU resource capacity remain outside this chart unless Ollama is deployed in-cluster with appropriate vendor GPU device plugins.
