/**
 * Live dashboard for edgeshield. Self-contained dark HTML,
 * polls /__shield/stats every 2s, no external assets.
 */
export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>edgeshield · Live Control & Guard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-sans,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d1117;color:#c9d1d9;line-height:1.6;padding:24px 16px}
.container{max-width:1050px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #21262d;padding-bottom:16px;margin-bottom:24px}
.brand{display:flex;align-items:center;gap:12px}
.logo{font-size:24px;font-weight:800;color:#58a6ff;letter-spacing:-0.02em}
.badge-live{font-size:11px;font-weight:600;background:#1f2937;color:#4ade80;border:1px solid #22c55e;padding:3px 10px;border-radius:999px;display:flex;align-items:center;gap:6px}
.badge-live::before{content:"";width:6px;height:6px;background:#22c55e;border-radius:50%;display:inline-block;animation:pulse 1.5s infinite}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px;position:relative;overflow:hidden;transition:border-color 0.2s}
.card:hover{border-color:#8b949e}
.card .label{font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.05em}
.card .value{font-size:28px;font-weight:700;color:#f0f6fc;margin-top:4px;font-variant-numeric:tabular-nums}
.card .sub{font-size:12px;color:#8b949e;margin-top:4px}
.text-ok{color:#3fb950}.text-bad{color:#f85149}.text-warn{color:#d29922}
.table-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin-top:24px}
.table-title{font-size:16px;font-weight:700;color:#f0f6fc;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between}
table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}
th{color:#8b949e;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;border-bottom:1px solid #30363d;padding:10px 12px}
td{border-bottom:1px solid #21262d;padding:12px;font-variant-numeric:tabular-nums}
.badge-action{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;display:inline-block;text-transform:uppercase}
.badge-allowed{background:rgba(63,185,80,0.15);color:#56d364}
.badge-blocked{background:rgba(248,81,73,0.15);color:#ff7b72}
.badge-banned{background:rgba(210,153,34,0.15);color:#e3b341}
footer{margin-top:40px;text-align:center;font-size:12px;color:#8b949e;border-top:1px solid #21262d;padding-top:16px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="brand">
      <span class="logo">edgeshield</span>
      <span class="badge-live">Live</span>
    </div>
    <div style="font-size:12px;color:#8b949e" id="clock">Connecting...</div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="label">Traffic Allowed</div>
      <div class="value text-ok" id="allowed">-</div>
      <div class="sub" id="allowedRate">- /sec</div>
    </div>
    <div class="card">
      <div class="label">Traffic Blocked</div>
      <div class="value text-bad" id="blocked">-</div>
      <div class="sub" id="blockedRate">- /sec</div>
    </div>
    <div class="card">
      <div class="label">Active Bans Escalating</div>
      <div class="value text-warn" id="bans">-</div>
      <div class="sub">dynamic duration</div>
    </div>
    <div class="card">
      <div class="label">Concurrency Gauge</div>
      <div class="value" id="conc">-</div>
      <div class="sub" id="highWater">high water -</div>
    </div>
  </div>

  <div class="table-card">
    <div class="table-title">
      <span>Decision Pipeline Log</span>
      <span style="font-size:11px;font-weight:normal;color:#8b949e">Polling status: Active (2s)</span>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Client IP</th>
            <th>Resource Path</th>
            <th>Shield Action</th>
            <th>Reason & Rule</th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr><td colspan="5" style="text-align:center;color:#8b949e;padding:24px">Waiting for traffic...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <footer>
    <p>edgeshield By Gopyr. Real-Time Autonomous Attack Mitigation Engine.</p>
  </footer>
</div>

<script>
function fmt(n){return Number(n).toLocaleString('en-US')}
function getBadgeClass(act){
  if(act==='allowed') return 'badge-allowed';
  if(act==='ban'||act==='banned') return 'badge-banned';
  return 'badge-blocked';
}
async function tick(){
  try{
    const r=await fetch('/__shield/stats');
    const d=await r.json();
    document.getElementById('allowed').textContent=fmt(d.totals.allowed);
    document.getElementById('allowedRate').textContent=d.rates.allowedPerSec+' /sec';
    document.getElementById('blocked').textContent=fmt(d.totals.blocked);
    document.getElementById('blockedRate').textContent=d.rates.blockedPerSec+' /sec';
    document.getElementById('bans').textContent=fmt(d.bans.active);
    document.getElementById('conc').textContent=d.concurrency.active+' / '+d.totals.concurrencyRejected+' rej';
    document.getElementById('highWater').textContent='high water '+d.concurrency.highWater;
    
    const rows=d.decisions.slice(0,20).map(x=>\`
      <tr>
        <td style="color:#8b949e">\${new Date(x.at).toLocaleTimeString()}</td>
        <td style="font-family:monospace;font-weight:600">\${x.ip}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;font-family:monospace">\${x.path||''}</td>
        <td><span class="badge-action \${getBadgeClass(x.action)}">\${x.action}</span></td>
        <td style="color:#8b949e">\${x.reason||''}</td>
      </tr>
    \`).join('');
    document.getElementById('rows').innerHTML=rows||'<tr><td colspan="5" style="text-align:center;color:#8b949e;padding:24px">No decision logs yet</td></tr>';
    document.getElementById('clock').textContent='Last sync: '+new Date().toLocaleTimeString();
  }catch(e){
    document.getElementById('clock').textContent='Offline (Lost Connection)';
  }  
}
tick();
setInterval(tick,2000);
</script>
</body>
</html>`;
}
