#!/usr/bin/env node
/**
 * edgeshield CLI.
 * Usage:
 *   edgeshield --config config.json
 *   edgeshield --target 127.0.0.1:3000 --port 8080 (bare defaults)
 *   edgeshield --block-ip 1.2.3.4 (reroute: add a temporary block rule)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEdgeShield } from './proxy.mjs';

const VERSION = '0.1.0';

function parseArgs(argv) {
  const opts = {
    config: null, target: null, port: null, host: '0.0.0.0',
    blockIp: null, help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--config': opts.config = argv[++i]; break;
      case '--target': opts.target = argv[++i]; break;
      case '--port': opts.port = Number(argv[++i]); break;
      case '--host': opts.host = argv[++i]; break;
      case '--block-ip': opts.blockIp = argv[++i]; break;
      case '--version': console.log(`edgeshield ${VERSION}`); process.exit(0); break;
      case '--help': case '-h': opts.help = true; break;
      default: console.error(`unknown option: ${a}`); process.exit(1);
    }
  }
  return opts;
}

const DEFAULTS = {
  target: { host: '127.0.0.1', port: 3000 },
  listen: { host: '0.0.0.0', port: 8080 },
  rate: { perIp: { capacity: 60, refillPerSec: 10 } },
  window: { maxPerWindow: 2000, windowMs: 60000 },
  concurrency: { max: 100 },
  slowloris: { headerTimeoutMs: 8000, requestTimeoutMs: 15000 },
  maxBodyBytes: 1048576,
  maxPathLen: 512,
  trustProxy: false,
  ban: { tiersMs: [60000, 300000, 900000], forgetMs: 600000 },
  rules: []
};

async function loadConfig(opts) {
  let cfg = { ...DEFAULTS };
  if (opts.config) {
    const raw = await readFile(opts.config, 'utf8');
    cfg = deepMerge(DEFAULTS, JSON.parse(raw));
  }
  if (opts.target) {
    const [host, port] = opts.target.split(':');
    cfg.target = { host: host || '127.0.0.1', port: Number(port) || 3000 };
  }
  if (opts.port) cfg.listen.port = opts.port;
  if (opts.blockIp) {
    cfg.rules = [...(cfg.rules || []), { action: 'block', match: { ip: [opts.blockIp] }, reason: 'manual block from CLI' }];
  }
  return cfg;
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`edgeshield ${VERSION}
Reverse proxy shield for small services. Rate limit per IP, concurrency cap,
slowloris timeout, size caps, rules engine, auto-ban escalation. Local-first, zero deps.

Usage:
  edgeshield --config config.json
  edgeshield --target 127.0.0.1:3000 --port 8080
  edgeshield --block-ip 1.2.3.4 --config config.json

Options:
  --config <file>        JSON config (target, rate, rules, ban tiers, ...)
  --target <host:port>   upstream to protect (default 127.0.0.1:3000)
  --port <n>             shield listen port (default 8080)
  --host <ip>            shield bind host (default 0.0.0.0)
  --block-ip <ip>        add a manual block rule (temporary, until restart)
  --version              print version
  --help                 this help

Dashboard: http://<host>:<port>/__shield`);
    return;
  }

  const cfg = await loadConfig(opts);
  const server = createEdgeShield(cfg);

  server.listen(cfg.listen.port, cfg.listen.host, () => {
    const t = cfg.target;
    console.log(`edgeshield ${VERSION} up`);
    console.log(`  shield   http://${cfg.listen.host}:${cfg.listen.port}`);
    console.log(`  target   http://${t.host}:${t.port}`);
    console.log(`  dashboard http://${cfg.listen.host}:${cfg.listen.port}/__shield`);
    console.log(`  rate     ${cfg.rate.perIp.capacity} burst / ${cfg.rate.perIp.refillPerSec}/s per IP`);
    console.log(`  concurrency max ${cfg.concurrency.max} · body max ${cfg.maxBodyBytes} B · path max ${cfg.maxPathLen}`);
    console.log(`  rules    ${(cfg.rules || []).length}`);
  });

  const shutdown = () => {
    console.log('\nshutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(`edgeshield: ${err.message}`);
  process.exit(1);
});