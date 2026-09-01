/**
 * Live dashboard for edgeshield. Self-contained dark HTML,
 * polls /__shield/stats every 2s, no external assets.
 */
export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>edgeshield · live</title>
<style>
*{box-sizing:border-box}
body{font-family:ui-sans,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b0f14;color:#e6edf3;line-height:1.5}
.wrap{max-width:960px;margin:0 auto;padding:28px 18px}
header{border-bottom:1px solid #1f2a36;padding-bottom:14px;margin-bottom:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:22px;margin:0}.live{font-size:11px;color:#4ade80;border:1px solid #15803d;padding:2px 8px;border-radius:999px}
.muted{color:#8b949e;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.card{background:#111824;border:1px solid #1f2a36;border-radius:12px;padding:12px 14px}
.card .k{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em}
.card .v{font-size:22px;font-weight:650;margin-top:3px;font-variant-numeric:tabular-nums}
.card .s{font-size:11px;color:#8b949e;margin-top:2px}
.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:#8b949e;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #1f2a36;padding:7px 8px}
td{border-bottom:1px solid #16202e;padding:7px 8px;font-variant-numeric:tabular-nums}
.tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px}
.tag-allowed{background:#052e16;color:#4ade80}.tag-blocked{background:#450a0a;color:#f87171}.tag-ban{background:#1c1917;color:#fbbf24}
footer{margin-top:26px;padding-top:12px;border-top:1px solid #1f2a36;color:#8b949e;font-size:12px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.pulse{animation:pulse 1.6s infinite}
</style>
<div class="wrap">
<header>
  <h1>edgeshield</h1><span class="live pulse">● live</span>
  <span class="muted" style="margin-left:auto" id="clock"></span>
</header>
<div class="grid">
  <div class="card"><div class="k">Allowed</div><div class="v ok" id="allowed">-</div><div class="s" id="allowedRate">- /s</div></div>
  <div class="card"><div class="k">Blocked</div><div class="v bad" id="blocked">-</div><div class="s" id="blockedRate">- /s</div></div>
  <div class="card"><div class="k">Active bans</div><div class="v warn" id="bans">-</div><div class="s">escalating</div></div>
  <div class="card"><div class="k">Concurrency</div><div class="v" id="conc">-</div><div class="s" id="highWater">high water -</div></div>
  <div class="card"><div class="k">Upstream bytes</div><div class="v" id="bytes">-</div><div class="s">forwarded</div></div>
  <div class="card"><div class="k">Uptime</div><div class="v" id="uptime">-</div><div class="s">since start</div></div>
</div>
<h2 style="font-size:15px;margin:0 0 8px">Recent decisions</h2>
<table>
<thead><tr><th>time</th><th>ip</th><th>path</th><th>action</th><th>reason</th></tr></thead>
<tbody id="rows"><tr><td colspan="5" class="muted">waiting for traffic...</td></tr></tbody>
</table>
<footer>edgeshield. Local-first shield. Dashboard never proxied.</footer>
</div>
<script>
function fmt(n){return Number(n).toLocaleString('en-US')}
function cls(action){return action==='allowed'?'tag-allowed':action==='ban'||action==='banned'?'tag-ban':'tag-blocked'}
async function tick(){
  try{
    const r=await fetch('/__shield/stats');const d=await r.json();
    set('allowed',fmt(d.totals.allowed));set('allowedRate',d.rates.allowedPerSec+' /s');
    set('blocked',fmt(d.totals.blocked));set('blockedRate',d.rates.blockedPerSec+' /s');
    set('bans',fmt(d.bans.active));set('conc',d.concurrency.active+' / '+d.totals.concurrencyRejected+' rej');
    set('highWater','high water '+d.concurrency.highWater);
    set('bytes',fmt(d.totals.bytesForwarded));
    const u=d.uptimeSec;set('uptime',Math.floor(u/60)+'m '+Math.floor(u%60)+'s');
    const rows=d.decisions.slice(0,18).map(x=>\`<tr><td>\${new Date(x.at).toLocaleTimeString()}</td><td>\${x.ip}</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">\${x.path||''}</td><td><span class="tag \${cls(x.action)}">\${x.action}</span></td><td class="muted">\${x.reason||''}</td></tr>\`).join('');
    document.getElementById('rows').innerHTML=rows||'<tr><td colspan="5" class="muted">no traffic yet</td></tr>';
    document.getElementById('clock').textContent='updated '+new Date().toLocaleTimeString();
  }catch(e){document.getElementById('clock').textContent='offline'}  
}
function set(id,v){document.getElementById(id).textContent=v}
tick();setInterval(tick,2000);
</script>
</html>`;
}