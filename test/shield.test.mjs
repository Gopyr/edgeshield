import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, WindowCounter, ConcurrencyGauge, BanManager } from '../src/limiters.mjs';
import { normalizeIp, ipInCidr, evaluateRuleset, bodyTooLarge, pathTooLong } from '../src/rules.mjs';

test('token bucket allows burst up to capacity', () => {
  let t = 0;
  const b = new TokenBucket({ capacity: 5, refillPerSec: 1, now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(b.take().allowed, true);
  assert.equal(b.take().allowed, false);
});

test('token bucket refills over time', () => {
  let t = 0;
  const b = new TokenBucket({ capacity: 5, refillPerSec: 10, now: () => t });
  for (let i = 0; i < 5; i++) b.take();
  assert.equal(b.take().allowed, false);
  t += 1000; // 1s later, 10 tokens available -> allowed
  assert.equal(b.take().allowed, true);
});

test('window counter rejects after max in window', () => {
  let t = 0;
  const c = new WindowCounter({ maxPerWindow: 3, windowMs: 1000, now: () => t });
  assert.equal(c.take().allowed, true);
  assert.equal(c.take().allowed, true);
  assert.equal(c.take().allowed, true);
  assert.equal(c.take().allowed, false);
  t += 1100;
  assert.equal(c.take().allowed, true);
});

test('concurrency gauge caps and tracks high water', () => {
  const g = new ConcurrencyGauge({ max: 2 });
  assert.equal(g.acquire(), true);
  assert.equal(g.acquire(), true);
  assert.equal(g.acquire(), false);
  g.release();
  assert.equal(g.acquire(), true);
  assert.equal(g.highWater, 2);
});

test('ban manager escalates tiers on repeated strikes', () => {
  let t = 0;
  const bm = new BanManager({ tiersMs: [1000, 5000, 15000], forgetMs: 60000, now: () => t });
  assert.equal(bm.isBanned('1.1.1.1'), false);
  const s1 = bm.strike('1.1.1.1');
  assert.equal(s1.durationMs, 1000);
  assert.equal(bm.isBanned('1.1.1.1'), true);
  t += 500;
  const s2 = bm.strike('1.1.1.1');
  assert.equal(s2.durationMs, 5000); // escalated
  assert.equal(s2.strikes, 2);
  t += 60000;
  assert.equal(bm.isBanned('1.1.1.1'), false);
});

test('normalizeIp handles ipv4-mapped and bracketed', () => {
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('[::1]:8080'), '::1');
});

test('ipInCidr matches networks and rejects outside', () => {
  assert.equal(ipInCidr('192.168.1.5', '192.168.1.0/24'), true);
  assert.equal(ipInCidr('192.168.2.5', '192.168.1.0/24'), false);
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.1'), true);
  assert.equal(ipInCidr('192.168.1.5', 'not-an-ip'), false);
});

test('evaluateRuleset first match wins, default allow', () => {
  const rules = [
    { action: 'block', match: { path: ['/admin'] }, reason: 'admin blocked' },
    { action: 'allow', match: { ip: ['127.0.0.1'] }, reason: 'local' }
  ];
  assert.equal(evaluateRuleset(rules, { ip: '8.8.8.8', path: '/admin', method: 'GET' }).action, 'block');
  assert.equal(evaluateRuleset(rules, { ip: '127.0.0.1', path: '/admin', method: 'GET' }).action, 'block'); // path rule first
  assert.equal(evaluateRuleset(rules, { ip: '127.0.0.1', path: '/', method: 'GET' }).action, 'allow');
  assert.equal(evaluateRuleset([], { ip: '1.1.1.1', path: '/' }).action, 'allow');
});

test('bodyTooLarge and pathTooLong', () => {
  assert.equal(bodyTooLarge(2048, 1024), true);
  assert.equal(bodyTooLarge(512, 1024), false);
  assert.equal(bodyTooLarge(undefined, 1024), false);
  assert.equal(pathTooLong('a'.repeat(600), 512), true);
  assert.equal(pathTooLong('/ok', 512), false);
});