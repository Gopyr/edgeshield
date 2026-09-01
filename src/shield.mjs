/**
 * Shield pipeline: the decision core that runs per request.
 * Stateless regarding sockets; state lives in the limiter/ban instances.
 */
import { TokenBucket, WindowCounter, ConcurrencyGauge, BanManager } from './limiters.mjs';
import { normalizeIp, evaluateRuleset, bodyTooLarge, pathTooLong } from './rules.mjs';

export class Shield {
  /**
   * opts:
   *  target { host, port }
   *  listenPort
   *  rate { perIp: {capacity, refillPerSec} }
   *  window { maxPerWindow, windowMs } (optional sliding window)
   *  concurrency { max }
   *  slowloris { headerTimeoutMs, requestTimeoutMs }
   *  maxBodyBytes, maxPathLen
   *  rules: []
   *  trustProxy (bool): if true, use x-forwarded-for first hop.
   */
  constructor(opts = {}) {
    this.opts = opts;
    const rate = opts.rate?.perIp ?? { capacity: 60, refillPerSec: 10 };
    this.bucketFor = new Map();
    this.defaultBucket = new TokenBucket(rate);
    this.window = opts.window ? new WindowCounter(opts.window) : null;
    this.concurrency = new ConcurrencyGauge(opts.concurrency ?? { max: 50 });
    this.bans = new BanManager(opts.ban ?? {});
    this.stats = {
      total: 0, allowed: 0, blocked: 0, banned: 0, concurrencyRejected: 0,
      rateLimited: 0, slowloris: 0, bodyTooLarge: 0, pathTooLong: 0, ruleBlocked: 0,
      bytesForwarded: 0, startedAt: Date.now()
    };
    this.decisions = []; // ring of recent decisions for the dashboard
    this.MAX_DECISIONS = 200;
    this.target = opts.target ?? { host: '127.0.0.1', port: 3000 };
  }

  _bucket(ip) {
    let b = this.bucketFor.get(ip);
    if (!b) {
      b = new TokenBucket(this.opts.rate?.perIp ?? { capacity: 60, refillPerSec: 10 });
      this.bucketFor.set(ip, b);
      // Housekeeping: cap map size to avoid unbounded growth.
      if (this.bucketFor.size > 10_000) {
        for (const key of this.bucketFor.keys()) {
          if (this.bucketFor.size <= 10_000) break;
          this.bucketFor.delete(key);
        }
      }
    }
    return b;
  }

  _record(decision) {
    this.decisions.push({ at: Date.now(), ...decision });
    if (this.decisions.length > this.MAX_DECISIONS) this.decisions.shift();
  }

  /**
   * Evaluate an incoming request. Returns one of:
   *  { ok: true }  - pass through
   *  { ok: false, status, reason, retryAfterMs? }
   * ctx: { ip, path, method, headers, query }
   */
  evaluate(ctx) {
    this.stats.total += 1;
    const ip = normalizeIp(ctx.ip);
    ctx.ip = ip;

    // 1. Ban check
    if (this.bans.isBanned(ip)) {
      this.stats.banned += 1;
      this.stats.blocked += 1;
      const b = this.bans.get(ip);
      this._record({ ip, path: ctx.path, action: 'banned', reason: `temporary ban (strike ${b?.strikes})`, status: 429 });
      return { ok: false, status: 429, reason: 'rate limited: temporary ban active', retryAfterMs: Math.max(1, b.until - Date.now()) };
    }

    // 2. Rules engine (first match wins)
    const rule = evaluateRuleset(this.opts.rules, ctx);
    if (rule.action === 'block') {
      this.stats.ruleBlocked += 1;
      this.stats.blocked += 1;
      this._record({ ip, path: ctx.path, action: 'block', reason: rule.reason, status: 403 });
      return { ok: false, status: 403, reason: rule.reason };
    }

    // 3. Path length guard
    if (pathTooLong(ctx.path, this.opts.maxPathLen ?? 512)) {
      this.stats.pathTooLong += 1;
      this.stats.blocked += 1;
      this._record({ ip, path: ctx.path, action: 'block', reason: 'path too long', status: 414 });
      return { ok: false, status: 414, reason: 'path too long' };
    }

    // 4. Body size guard
    if (bodyTooLarge(ctx.contentLength, this.opts.maxBodyBytes ?? 1024 * 1024)) {
      this.stats.bodyTooLarge += 1;
      this.stats.blocked += 1;
      this._record({ ip, path: ctx.path, action: 'block', reason: 'body too large', status: 413 });
      return { ok: false, status: 413, reason: 'body too large' };
    }

    // 5. Per-IP token bucket
    const taken = this._bucket(ip).take();
    if (!taken.allowed) {
      this.stats.rateLimited += 1;
      this.stats.blocked += 1;
      this._record({ ip, path: ctx.path, action: 'rate-limit', reason: 'per-ip rate limit', status: 429 });
      // Escalate: consecutive violations -> temp ban
      const ban = this.bans.strike(ip);
      this._record({ ip, path: ctx.path, action: 'ban', reason: `rate limit escalation (strike ${ban.strikes})`, status: 429 });
      return { ok: false, status: 429, reason: 'rate limited', retryAfterMs: taken.retryAfterMs };
    } else if (this.bans.get(ip)) {
      // A burst that passes the bucket after a ban expired: clear the strike memory gradually.
      // Do nothing: decay happens via forgetMs.
    }

    // 6. Optional global sliding window
    if (this.window) {
      const w = this.window.take();
      if (!w.allowed) {
        this.stats.rateLimited += 1;
        this.stats.blocked += 1;
        this._record({ ip, path: ctx.path, action: 'rate-limit', reason: 'global window limit', status: 429 });
        return { ok: false, status: 429, reason: 'global rate limit', retryAfterMs: w.retryAfterMs };
      }
    }

    // 7. Concurrency cap
    if (!this.concurrency.acquire()) {
      this.stats.concurrencyRejected += 1;
      this.stats.blocked += 1;
      this._record({ ip, path: ctx.path, action: 'concurrency', reason: 'too many concurrent requests', status: 503 });
      return { ok: false, status: 503, reason: 'server busy: concurrency cap reached' };
    }

    this.stats.allowed += 1;
    return { ok: true };
  }

  release() {
    this.concurrency.release();
  }

  /** Mark bytes forwarded upstream (for dashboard metrics). */
  addForwardedBytes(n) {
    this.stats.bytesForwarded += n;
  }
}