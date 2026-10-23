import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockOllamaServer } from './server.mjs';

let server;
let base;

before(async () => {
  server = createMockOllamaServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('tags, ps, and Ollama-compatible final usage chunk', async () => {
  const tags = await fetch(`${base}/api/tags`).then((response) => response.json());
  assert.ok(tags.models.length >= 3);
  const ps = await fetch(`${base}/api/ps`).then((response) => response.json());
  assert.deepEqual(ps.models, []);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: tags.models[0].name, messages: [{ role: 'user', content: 'hello' }] }),
  });
  const text = await response.text();
  const chunks = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(chunks.at(-1).done, true);
  assert.equal(typeof chunks.at(-1).eval_count, 'number');
  assert.equal(typeof chunks.at(-1).load_duration, 'number');
  assert.ok(chunks.some((chunk) => chunk.message?.content));
});
