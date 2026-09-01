// Standalone demo target for the dashboard screenshot: slow-ish JSON API
import http from 'node:http';
const server = http.createServer((req, res) => {
  const delay = req.url.startsWith('/slow') ? 120 : 10;
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url, ts: Date.now() }));
  }, delay);
});
server.listen(3199, '127.0.0.1', () => console.log('demo target on 3199'));