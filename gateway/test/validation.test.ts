import { describe, expect, it } from 'vitest';
import { chatRequestSchema, previewRequestSchema } from '../src/validation.js';

describe('public request validation', () => {
  it('applies safe defaults and accepts a standard chat', () => {
    const parsed = chatRequestSchema.parse({ messages: [{ role: 'user', content: 'hello' }] });
    expect(parsed.mode).toBe('auto');
    expect(parsed.use_cache).toBe(true);
    expect(parsed.options.num_ctx).toBe(4096);
  });

  it('rejects prompt content over the aggregate limit', () => {
    const result = chatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'x'.repeat(32769) }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects force mode without a model', () => {
    expect(previewRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], mode: 'force' }).success).toBe(false);
  });

  it('rejects unsupported roles and too many messages', () => {
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'tool', content: 'x' }] }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ messages: Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' })) }).success).toBe(false);
  });
});
