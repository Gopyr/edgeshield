// Integration smoke test: target server + shield + attack simulation
import http from 'node:http';
import { createEdgeShield } from '../src/proxy.mjs';

const results = [];
function log(name, ok, detail) { results.push({ name, ok, detail }); }

// 1. Target server: responds 200 JSON, takes ~20ms
const target = http.createServer((req, res) => {
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  }, 20);
});
await new Promise(r => target.listen(3101, '127.0.0.1', r));

// 2. Shield with tight limits to prove protection
const config = {
  target: { host: '127.0.0.1', port: 3101 },
  listen: { host: '127.0.0.1', port: 3180 },
  rate: { perIp: { capacity: 5, refillPerSec: 2 } },
  concurrency: { max: 3 },
  slowloris: { headerTimeoutMs: 4000, requestTimeoutMs: 8000 },
  maxBodyBytes: 512,
  maxPathLen: 64,
  rules: [{ action: 'block', match: { path: ['/admin'] }, reason: 'sensitive path' }]
};
const server = createEdgeShield(config);
await new Promise(r => server.listen(3180, '127.0.0.1', r));

// 3. Helpers
function fetchShield(path, { method = 'GET', headers = {} } = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: 3180, path, method, headers }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, retryAfter: res.headers['retry-after'] }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

// 4. Normal request should pass
const ok = await fetchShield('/hello');
log('normal request passes', ok.status === 200, `status=${ok.status}`);

// 5. Sensitive path blocked by rule (403) - before any ban is active
const admin = await fetchShield('/admin');
log('sensitive path blocked', admin.status === 403, `status=${admin.status}`);

// 6. Concurrency cap: target now slow (~20ms), fire 8 parallel before rate limit burns
// Reset happens because each parallel request is evaluated immediately; burst of 5 is
// not consumed by parallel (they race). With max=3 slots, ~5 should be rejected 503.
const parallel = await Promise.all(Array.from({ length: 8 }, () => fetchShield('/conc')));
const rejected = parallel.filter(r => r.status === 503).length;
log('concurrency cap rejects overload', rejected >= 1, `rejected=${rejected}/8`);

// 7. Rate limit: 5 allowed burst, 6th should 429
for (let i = 0; i < 5; i++) await fetchShield('/burst');
const limited = await fetchShield('/burst');
log('6th request rate-limited', limited.status === 429, `status=${limited.status} retry=${limited.retryAfter}`);

// 8. Escalation to ban: keep hitting, should stay 429 and activate ban
let banned = false;
for (let i = 0; i < 4; i++) {
  const r = await fetchShield('/burst');
  if (r.status === 429) banned = true;
}
// server-side check
const statsRes = await fetchShield('/__shield/stats');
const stats = JSON.parse(statsRes.body);
log('auto-ban activated (multiple violations)', stats.bans.active === 1, `bans.active=${stats.bans.active}`);

// 9. Dashboard
const dash = await fetchShield('/__shield');
log('dashboard served', dash.status === 200 && dash.body.includes('edgeshield'), `status=${dash.status}`);

// 10. Stats JSON valid
log('stats endpoint valid JSON', statsRes.status === 200 && stats.totals !== undefined, `total=${stats.totals?.total}`);

server.close();
target.close();

// Report
let pass = 0;
for (const r of results) { console.log(`${r.ok ? '✔' : '✘'} ${r.name} ${r.ok ? '' : '-> ' + r.detail}`); if (r.ok) pass++; }
console.log(`\n${pass}/${results.length} integration checks passed`);
process.exit(pass === results.length ? 0 : 1);