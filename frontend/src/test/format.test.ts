import { describe, expect, it } from 'vitest';
import { formatDuration, formatPercent, percentile } from '../lib/format';
import { RingBuffer } from '../lib/ringBuffer';

describe('format helpers', () => {
  it('formats durations and ratios', () => {
    expect(formatDuration(42)).toBe('42 ms');
    expect(formatDuration(2500)).toBe('2.50 s');
    expect(formatPercent(0.25, true)).toBe('25%');
  });
  it('computes a percentile and handles empty samples', () => {
    expect(percentile([9, 1, 4], 0.5)).toBe(4);
    expect(percentile([], 0.95)).toBe(0);
  });
  it('keeps a bounded ring of newest values', () => {
    const buffer = new RingBuffer<number>(2);
    buffer.push(1); buffer.push(2); buffer.push(3);
    expect(buffer.toArray()).toEqual([2, 3]);
  });
});
