/** Small allocation-free helpers for performance instrumentation. */

/** Counts events in a sliding time window and reports a rate per second. */
export class RateMeter {
  private times: number[] = [];

  constructor(private readonly windowMs = 2000) {}

  tick(now: number): void {
    this.times.push(now);
    this.trim(now);
  }

  rate(now: number): number {
    this.trim(now);
    if (this.times.length < 2) return 0;
    const first = this.times[0] ?? now;
    const span = Math.max(now - first, 1);
    return ((this.times.length - 1) * 1000) / span;
  }

  reset(): void {
    this.times.length = 0;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.times.length && (this.times[drop] ?? 0) < cutoff) drop++;
    if (drop > 0) this.times.splice(0, drop);
  }
}

/** Fixed-size ring of samples with median / p95. */
export class RollingStats {
  private samples: number[] = [];
  private index = 0;

  constructor(private readonly capacity = 120) {}

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.samples.length < this.capacity) this.samples.push(value);
    else this.samples[this.index] = value;
    this.index = (this.index + 1) % this.capacity;
  }

  get count(): number {
    return this.samples.length;
  }

  percentile(p: number): number | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[i] ?? null;
  }

  reset(): void {
    this.samples.length = 0;
    this.index = 0;
  }
}
