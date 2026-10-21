# Contributing

Read `Rules.md` and `Tasks.md` before changing the project. `contracts/openapi.yaml`, JSON Schemas and `contracts/sse-events.md` are the source of truth for public request/response/stream shapes. Contract changes must be made and reviewed before dependent implementation changes.

## Development workflow

1. Use Node.js 24.22.0 and npm 11; install with `npm ci`.
2. Start a local deterministic stack with `npm run dev:mock`.
3. Add a regression test with behavior changes.
4. Run `npm run contracts:check`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
5. For Rust changes, also run `cargo fmt`, `cargo test`, and `cargo clippy` as documented in `docs/testing.md`.
6. Update README/config/contracts/docs in the same change and add an honest verification note to `docs/acceptance-status.md` if a gate could not run.

## Boundaries and standards

- Keep model names, thresholds, TTLs, endpoint defaults, and keyword lists in `config/` or environment variables.
- Keep routing policy in Rust; the gateway is a validation/proxy boundary and the UI only displays returned decisions.
- Never log prompt/response text at info level; do not commit `.env`, credentials, model weights, or private prompts.
- Preserve unbuffered SSE and cancellation; cache only completed eligible responses.
- Use conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) when committing.

## Pull request description

Include the problem, implementation, contract impact, tests/checks run, deployment impact, and remaining risks. A failed or unavailable tool is a blocker/limitation, not a passing check.
