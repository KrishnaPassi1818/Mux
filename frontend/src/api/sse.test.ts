import { describe, expect, it } from 'vitest';
import { parseSseFrame } from './sse';

describe('SSE frame parser', () => {
  it('parses event and JSON data', () => {
    expect(parseSseFrame('event: token\ndata: {"text":"hello"}')).toEqual({ event: 'token', data: '{"text":"hello"}' });
  });

  it('joins multiline data and ignores heartbeat comments', () => {
    expect(parseSseFrame(': ping\nevent: stats\ndata: {"a":\ndata: 1}')).toEqual({ event: 'stats', data: '{"a":\n1}' });
    expect(parseSseFrame(': ping')).toBeNull();
  });

  it('accepts CRLF input', () => {
    expect(parseSseFrame('event: done\r\ndata: {}\r\n')).toEqual({ event: 'done', data: '{}' });
  });
});
