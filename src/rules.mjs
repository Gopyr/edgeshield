/**
 * Rule engine: decide allow/block/mark based on request properties.
 * Pure functions, no I/O.
 */

/**
 * Normalize an IP-ish string.
 * Handles "::ffff:1.2.3.4" (IPv4-mapped), strips port in "[::1]:8080" style.
 */
export function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const m = ip.match(/^\[([^\]]+)\]/);
  if (m) ip = m[1];
  const portIdx = ip.lastIndexOf(':');
  // Only strip trailing port if it looks like :digits and there's a single colon (IPv4) 
  // or the string is [v6]:port already handled above.
  if (/^\d+$/.test(ip.slice(portIdx + 1)) && ip.indexOf(':') === portIdx && !ip.includes('.')) {
    // bare "host:port" with no dots (e.g. localhost:3000) - keep it; not an IP we normalize further
  }
  return ip;
}

/** Match an IP against a CIDR block like "10.0.0.0/8" or a plain IP. */
export function ipInCidr(ip, cidr) {
  let network = cidr.trim();
  let prefix = 32;
  const parts = network.split('/');
  if (parts.length === 2) {
    network = parts[0];
    prefix = Number(parts[1]);
    if (!Number.isFinite(prefix)) return false;
  }
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

export function ipv4ToInt(ip) {
  const m = String(ip).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some(o => o > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

/**
 * Evaluate a single rule against a request context.
 * ctx: { ip, path, method, userAgent, query }
 * rule: { action: 'allow'|'block'|'mark', match: { ip|cidr|path|method|userAgent|exact? }, reason }
 * Returns null if rule does not match, else { action, reason, rule }.
 */
export function evaluateRule(rule, ctx) {
  if (!rule || !rule.action || !rule.match) return null;
  const m = rule.match;
  let matched = false;
  if (m.ip !== undefined) matched = matched || m.ip === ctx.ip;
  if (m.cidr !== undefined) {
    const arr = Array.isArray(m.cidr) ? m.cidr : [m.cidr];
    matched = matched || arr.some(c => ipInCidr(ctx.ip, c));
  }
  if (m.path !== undefined) {
    const paths = Array.isArray(m.path) ? m.path : [m.path];
    matched = matched || paths.some(p => (p.endsWith('*') ? ctx.path.startsWith(p.slice(0, -1)) : p === ctx.path));
  }
  if (m.method !== undefined) {
    const ms = Array.isArray(m.method) ? m.method : [m.method];
    matched = matched || ms.includes(String(ctx.method || '').toUpperCase());
  }
  if (m.userAgent !== undefined) {
    const uas = Array.isArray(m.userAgent) ? m.userAgent : [m.userAgent];
    const ua = String(ctx.userAgent || '');
    matched = matched || uas.some(u => new RegExp(u, 'i').test(ua));
  }
  if (m.query !== undefined) {
    // query: key=value or key (presence)
    for (const q of (Array.isArray(m.query) ? m.query : [m.query])) {
      const eq = q.indexOf('=');
      if (eq === -1) {
        matched = matched || Object.prototype.hasOwnProperty.call(ctx.query || {}, q);
      } else {
        const k = q.slice(0, eq), v = q.slice(eq + 1);
        matched = matched || ((ctx.query || {})[k] === v);
      }
    }
  }
  if (!matched) return null;
  return { action: rule.action, reason: rule.reason || `rule: ${rule.action}`, rule };
}

/**
 * Run a ruleset (array of rules) in order. First match wins.
 * Returns { action, reason, rule } or { action: 'allow', reason: 'no matching rule' }.
 */
export function evaluateRuleset(rules, ctx) {
  for (const r of rules || []) {
    const hit = evaluateRule(r, ctx);
    if (hit) return hit;
  }
  return { action: 'allow', reason: 'no matching rule' };
}

/** Apply a global cap on request body size. */
export function bodyTooLarge(contentLength, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  if (contentLength === undefined || contentLength === null) return false;
  return Number(contentLength) > maxBytes;
}

/** Check URL path against a maximum length (pathology guard). */
export function pathTooLong(path, maxLen) {
  return path.length > maxLen;
}