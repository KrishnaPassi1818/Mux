export class RingBuffer<T> {
  private values: T[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('RingBuffer capacity must be a positive integer.');
    this.capacity = capacity;
  }

  push(value: T): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.splice(0, this.values.length - this.capacity);
  }

  toArray(): T[] { return [...this.values]; }
  clear(): void { this.values = []; }
  get length(): number { return this.values.length; }
}
