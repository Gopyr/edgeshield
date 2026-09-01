/**
 * Token bucket rate limiter. Pure logic, no timers or I/O.
 *
 * A bucket holds up to `capacity` tokens. Each request costs 1 token.
 * Tokens refill at `refillPerSec` per second, capped at capacity.
 * Burst capacity and sustained rate are therefore independent knobs.
 */
export class TokenBucket {
  constructor({ capacity = 60, refillPerSec = 10, now = Date.now } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this._now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  _refill() {
    const t = this._now();
    const elapsed = Math.max(0, (t - this.updatedAt) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.updatedAt = t;
  }

  /**
   * Try to consume one token.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  take() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }
    const wait = (1 - this.tokens) / this.refillPerSec * 1000;
    return { allowed: false, retryAfterMs: Math.ceil(Math.max(1, wait)) };
  }

  reset() {
    this.tokens = this.capacity;
    this.updatedAt = this._now();
  }
}

/**
 * Sliding-window counter limiter: counts requests in the last `windowMs`
 * and rejects when the count would exceed `maxPerWindow`.
 * Simpler to reason about than token buckets for "N requests per minute".
 */
export class WindowCounter {
  constructor({ maxPerWindow = 100, windowMs = 60_000, now = Date.now } = {}) {
    this.max = maxPerWindow;
    this.windowMs = windowMs;
    this._now = now;
    this.hits = [];
  }

  take() {
    const t = this._now();
    while (this.hits.length && this.hits[0] <= t - this.windowMs) this.hits.shift();
    if (this.hits.length >= this.max) {
      const oldest = this.hits[0];
      return { allowed: false, retryAfterMs: Math.ceil(oldest + this.windowMs - t) };
    }
    this.hits.push(t);
    return { allowed: true };
  }
}

/**
 * Concurrency gauge: tracks in-flight requests.
 * Useful for protecting an upstream that dies under parallelism.
 */
export class ConcurrencyGauge {
  constructor({ max = 50, now = Date.now } = {}) {
    this.max = max;
    this._now = now;
    this.active = 0;
    this.highWater = 0;
  }

  /** Returns true if a slot is available and takes it. */
  acquire() {
    if (this.active >= this.max) return false;
    this.active += 1;
    if (this.active > this.highWater) this.highWater = this.active;
    return true;
  }

  release() {
    if (this.active > 0) this.active -= 1;
  }
}

/**
 * Fixed-window ban state per IP with escalating durations.
 * banStrikes: consecutive violations within `forgetMs` raise the ban tier.
 */
export class BanManager {
  constructor({ tiersMs = [60_000, 300_000, 900_000], forgetMs = 10 * 60_000, now = Date.now } = {}) {
    this.tiers = tiersMs;
    this.forgetMs = forgetMs;
    this._now = now;
    this.bans = new Map(); // ip -> { until, strikes, lastViolation }
  }

  isBanned(ip) {
    const b = this.bans.get(ip);
    if (!b) return false;
    if (this._now() > b.until) {
      this.bans.delete(ip);
      return false;
    }
    return true;
  }

  /** Record a violation; returns the ban duration applied. */
  strike(ip) {
    const t = this._now();
    const prev = this.bans.get(ip);
    let strikes = 1;
    if (prev && t - prev.lastViolation < this.forgetMs) {
      strikes = prev.strikes + 1;
    }
    const tier = Math.min(this.tiers.length, strikes) - 1;
    const until = t + this.tiers[tier];
    this.bans.set(ip, { until, strikes, lastViolation: t });
    return { durationMs: this.tiers[tier], strikes, until };
  }

  clear(ip) {
    this.bans.delete(ip);
  }

  get(ip) {
    return this.bans.get(ip);
  }

  size() {
    return this.bans.size;
  }
}