/**
 * edgeshield HTTP server: applies the shield pipeline, proxies allowed
 * requests to the target, and serves the live dashboard.
 */
import http from 'node:http';
import { Shield } from './shield.mjs';
import { dashboardHtml } from './dashboard.mjs';

export function createEdgeShield(config) {
  const shield = new Shield(config);

  const server = http.createServer((req, res) => {
    // Dashboard routes (never proxied, not counted as attack traffic).
    if (req.url === '/__shield' || req.url === '/__shield/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml());
      return;
    }
    if (req.url === '/__shield/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(shieldStats(shield)));
      return;
    }

    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req, config.trustProxy);
    const ctx = {
      ip,
      path: url.pathname,
      method: req.method,
      userAgent: req.headers['user-agent'] || '',
      query: Object.fromEntries(url.searchParams),
      contentLength: req.headers['content-length'] !== undefined ? Number(req.headers['content-length']) : undefined
    };

    const decision = shield.evaluate(ctx);
    if (!decision.ok) {
      const headers = { 'content-type': 'application/json; charset=utf-8' };
      if (decision.retryAfterMs !== undefined) headers['retry-after'] = String(Math.ceil(decision.retryAfterMs / 1000));
      res.writeHead(decision.status, headers);
      res.end(JSON.stringify({ error: decision.reason, retryAfterMs: decision.retryAfterMs ?? null }));
      return;
    }

    // Forward upstream.
    const target = config.target ?? { host: '127.0.0.1', port: 3000 };
    const proxyReq = http.request({
      host: target.host,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${target.host}:${target.port}` }
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.on('data', chunk => shield.addForwardedBytes(chunk.length));
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'upstream unreachable', detail: err.message }));
      } else {
        res.destroy();
      }
    });

    req.pipe(proxyReq);
    res.on('close', () => shield.release());
  });

  // Slowloris protection: fail requests that take too long to send headers/body.
  const sl = config.slowloris ?? {};
  server.headersTimeout = sl.headerTimeoutMs ?? 8_000;
  server.requestTimeout = sl.requestTimeoutMs ?? 15_000;
  server.timeout = sl.socketTimeoutMs ?? 30_000;

  return server;
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function shieldStats(shield) {
  const s = shield.stats;
  const uptimeSec = Math.round((Date.now() - s.startedAt) / 1000);
  return {
    uptimeSec,
    totals: { ...s },
    rates: {
      allowedPerSec: +(s.allowed / (uptimeSec || 1)).toFixed(2),
      blockedPerSec: +(s.blocked / (uptimeSec || 1)).toFixed(2)
    },
    bans: { active: shield.bans.size() },
    concurrency: { active: shield.concurrency.active, highWater: shield.concurrency.highWater },
    decisions: shield.decisions.slice(-50).reverse()
  };
}