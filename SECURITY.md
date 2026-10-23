# Security policy

## Intended deployment

LLM Router v1 is a local, single-user development/demo system. The gateway has request validation, a body-size limit, rate limiting, request IDs, CORS allow-listing, Helmet headers, and structured privacy-aware logging. The router repeats message/option validation, and response caching is limited to complete low-temperature answers. Containers are configured non-root with read-only root filesystems where practical; Redis and router ports are not published in the base Compose file.

There is **no API-key authentication, tenant isolation, authorization, or audit identity**. Do not expose the UI/API, Redis, Ollama, or Grafana to untrusted networks. A local binding does not imply safe public exposure.

## Handling private prompts

- Prompts and responses are not logged at info level; router logs use a prompt hash and length.
- Avoid adding real personal data to fixtures, benchmark datasets, screenshots, or committed result files.
- Redis cache entries contain complete generated responses. Treat the Redis volume as sensitive data and remove it when appropriate.
- Benchmark results may contain prompt identifiers and timing metadata. The current runner does not include raw prompt text in per-request output.

## Secrets and network controls

- `.env` is ignored by Git; `.env.example` contains only placeholders.
- Set `GRAFANA_ADMIN_PASSWORD` to a local secret before using the monitoring overlay. Do not use the sample value outside an isolated local demo.
- Ollama generally has no authentication. If Docker/Kubernetes must reach the host API, bind only to an appropriate local/bridge interface and restrict inbound access with host firewall rules.
- Add TLS, authentication, request authorization, stricter network policies, secret management, and Redis authentication before any shared or remote deployment.

## Reporting vulnerabilities

Do not open a public issue containing credentials, private prompts, or exploit details. Use the repository owner's private security reporting channel; none is configured in this scaffold. For local evaluation, record findings in a non-public report and rotate exposed secrets immediately.
