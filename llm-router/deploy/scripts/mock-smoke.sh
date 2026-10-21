#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

check_json() {
  local path="$1"
  local output="$2"
  curl --silent --show-error --fail "$BASE_URL$path" -o "$output"
}

check_json /api/health "$TMP_DIR/health.json"
node --input-type=module - "$TMP_DIR/health.json" <<'NODE'
import { readFileSync } from 'node:fs';
const health = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!health.status || health.status === 'unavailable') throw new Error('Gateway/router health is unavailable.');
console.log(`PASS health (${health.status})`);
NODE

check_json /api/models "$TMP_DIR/models.json"
node --input-type=module - "$TMP_DIR/models.json" <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(value.models) || value.models.length < 3) throw new Error('Expected three configured models.');
console.log(`PASS model registry (${value.models.length} models)`);
NODE

curl --silent --show-error --fail -X POST "$BASE_URL/api/route/preview" \
  -H 'content-type: application/json' \
  --data '{"messages":[{"role":"user","content":"Hello from the smoke test"}],"mode":"auto"}' \
  -o "$TMP_DIR/preview.json"
node --input-type=module - "$TMP_DIR/preview.json" <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!value.model || !value.tier || typeof value.score !== 'number') throw new Error('Preview response is incomplete.');
console.log(`PASS route preview (${value.tier})`);
NODE

PROMPT="Compose mock smoke $(date +%s%N)"
node --input-type=module - "$PROMPT" "$TMP_DIR/payload.json" <<'NODE'
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[3], JSON.stringify({ messages: [{ role: 'user', content: process.argv[2] }], use_cache: true }));
NODE

for attempt in 1 2; do
  curl --silent --show-error --fail --no-buffer --max-time 90 \
    -X POST "$BASE_URL/api/chat" \
    -H 'content-type: application/json' -H 'accept: text/event-stream' \
    --data-binary "@$TMP_DIR/payload.json" \
    -o "$TMP_DIR/chat-$attempt.sse"
done
node --input-type=module - "$TMP_DIR/chat-1.sse" "$TMP_DIR/chat-2.sse" <<'NODE'
import { readFileSync } from 'node:fs';
const events = (path) => {
  const text = readFileSync(path, 'utf8');
  return text.split(/\r?\n\r?\n/u).flatMap((frame) => {
    const event = frame.match(/^event: (.+)$/mu)?.[1];
    const data = frame.match(/^data: (.+)$/mu)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) }] : [];
  });
};
const first = events(process.argv[2]);
const second = events(process.argv[3]);
if (first[0]?.event !== 'meta' || !first.some((item) => item.event === 'token') || first.at(-1)?.event !== 'done') throw new Error('Expected meta, token, and terminal done events.');
if (second[0]?.event !== 'meta' || second[0]?.data?.cache !== 'hit' || second.at(-1)?.event !== 'done') throw new Error('Exact repeat did not return a cache-hit stream.');
console.log('PASS SSE meta → token* → done');
console.log('PASS exact repeat returns cache hit');
NODE
