import * as http from 'http';
import { readStats, aggregate, getStatsFilePath, formatMonthlyCsv, type Aggregates } from './stats.js';

const DEFAULT_PORT = 4734;

export function startDashboard(port: number = DEFAULT_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      const agg = aggregate(readStats());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agg));
      return;
    }
    if (req.url === '/api/export') {
      const records = readStats();
      const agg = aggregate(records);
      const payload = { aggregates: agg, records };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="tokenslayer-stats.json"',
      });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }
    if (req.url === '/api/export/monthly.csv') {
      const agg = aggregate(readStats());
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tokenslayer-monthly.csv"',
      });
      res.end(formatMonthlyCsv(agg));
      return;
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHTML());
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\n⚡ TokenSlayer Dashboard running at: http://localhost:${port}`);
    console.log(`   Stats file: ${getStatsFilePath()}`);
    console.log(`   Press Ctrl+C to stop.\n`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${port} is already in use.`);
      console.error(`   Try: node build/index.js --dashboard --port=4735\n`);
      process.exit(1);
    } else {
      console.error('Dashboard server error:', err);
      process.exit(1);
    }
  });

  return server;
}

function renderHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⚡ TokenSlayer Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --panel-2: #1c232c;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #7d8590;
      --accent: #58a6ff;
      --accent-2: #a371f7;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 32px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    .header-left { }
    h1 {
      font-size: 24px;
      margin: 0 0 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      display: inline-block;
    }
    .sub { color: var(--muted); font-size: 13px; }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    .status { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 11px; }
    .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      font-family: inherit;
    }
    .btn:hover { border-color: var(--accent); background: var(--panel-2); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      transition: border-color 0.15s;
    }
    .card:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
    .card .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card .value { font-size: 26px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .card .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .hero { grid-column: 1 / -1; padding: 28px 32px; position: relative; overflow: hidden; }
    .hero::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -20%;
      width: 300px;
      height: 300px;
      background: radial-gradient(circle, color-mix(in srgb, var(--green) 8%, transparent), transparent 70%);
      pointer-events: none;
    }
    .hero .value {
      font-size: 52px;
      background: linear-gradient(90deg, var(--green), var(--accent));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .hero .meta { color: var(--muted); font-size: 14px; margin-top: 6px; }
    .highlight { color: var(--green); }
    .cost-highlight { color: var(--yellow); }
    .section { margin-top: 24px; }
    .section h2 {
      font-size: 14px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 12px;
      font-weight: 600;
    }
    .sparkline-container {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .sparkline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .sparkline-header h2 { margin: 0; }
    .sparkline-header .sparkline-total { color: var(--green); font-size: 14px; font-weight: 600; }
    canvas { display: block; width: 100%; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      text-align: left;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    th { background: var(--panel-2); color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: color-mix(in srgb, var(--accent) 3%, transparent); }
    .file { font-family: ui-monospace, "SF Mono", Monaco, monospace; color: var(--accent); font-size: 12px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .pct { color: var(--green); font-weight: 600; }
    .bar {
      display: inline-block;
      height: 6px;
      background: linear-gradient(90deg, var(--green), var(--accent));
      border-radius: 3px;
      vertical-align: middle;
      margin-right: 8px;
      transition: width 0.5s ease;
    }
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
      background: var(--panel);
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
    .empty .icon { font-size: 48px; margin-bottom: 12px; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      font-family: ui-monospace, monospace;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>⚡ TokenSlayer</h1>
      <div class="sub">Cumulative savings across all MCP calls — Cursor, Claude Code, Claude Desktop, Windsurf, CLI.</div>
    </div>
    <div class="header-actions">
      <span class="status"><span class="dot"></span>auto-refresh 5s</span>
      <button class="btn" id="exportBtn" title="Download stats as JSON">📥 Export JSON</button>
      <button class="btn" id="exportCsvBtn" title="Download monthly breakdown as CSV">📊 Export CSV</button>
    </div>
  </div>

  <div id="root"></div>
  <div class="footer" id="footer"></div>

  <script>
    function fmtNum(n) { return n.toLocaleString('en-US'); }
    function fmtRelTime(iso) {
      if (!iso) return 'never';
      var diff = Date.now() - new Date(iso).getTime();
      var s = Math.floor(diff / 1000);
      if (s < 60) return s + 's ago';
      var m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      var h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    }
    function shortPath(p, max) {
      max = max || 60;
      if (p.length <= max) return p;
      var parts = p.split('/');
      if (parts.length <= 2) return '...' + p.slice(-(max - 3));
      return '.../' + parts.slice(-3).join('/');
    }
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtMonthLabel(key) {
      var parts = key.split('-');
      var idx = parseInt(parts[1], 10) - 1;
      return (idx >= 0 && idx < 12) ? MONTH_NAMES[idx] + ' ' + parts[0] : key;
    }
    function formatMomDelta(delta, percent) {
      if (delta == null) return '—';
      if (delta === 0) return '→ flat';
      var arrow = delta > 0 ? '↑' : '↓';
      var abs = Math.abs(delta).toLocaleString('en-US');
      if (percent != null) return arrow + ' ' + abs + ' (' + (percent > 0 ? '+' : '') + percent + '%)';
      return arrow + ' ' + abs;
    }

    function drawSparkline(canvasId, timeline) {
      var canvas = document.getElementById(canvasId);
      if (!canvas || !timeline || timeline.length < 2) {
        if (canvas) {
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'rgba(125,133,144,0.4)';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Activity will appear here after multiple calls', canvas.width / 2, canvas.height / 2 + 4);
        }
        return;
      }
      var ctx = canvas.getContext('2d');
      var w = canvas.width;
      var h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      var values = timeline.map(function(d) { return d.totalSavedCumulative; });
      var max = Math.max.apply(null, values) || 1;
      var min = Math.min.apply(null, values);
      var range = max - min || 1;
      var stepX = w / (values.length - 1);

      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(63, 185, 80, 0.3)');
      grad.addColorStop(1, 'rgba(63, 185, 80, 0.02)');

      ctx.beginPath();
      ctx.moveTo(0, h);
      for (var i = 0; i < values.length; i++) {
        var x = i * stepX;
        var y = h - ((values[i] - min) / range) * (h - 12) - 6;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      for (var i = 0; i < values.length; i++) {
        var x = i * stepX;
        var y = h - ((values[i] - min) / range) * (h - 12) - 6;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(63, 185, 80, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();

      for (var i = Math.max(0, values.length - 3); i < values.length; i++) {
        var x = i * stepX;
        var y = h - ((values[i] - min) / range) * (h - 12) - 6;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#3fb950';
        ctx.fill();
        ctx.strokeStyle = '#0d1117';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    var lastData = null;

    async function render() {
      var r = await fetch('/api/stats');
      var a = await r.json();
      lastData = a;
      var root = document.getElementById('root');
      var footer = document.getElementById('footer');

      if (a.totalAnalyses === 0) {
        root.innerHTML = '<div class="empty"><div class="icon">📊</div><div><strong>No analyses recorded yet.</strong></div><div style="margin-top:8px;font-size:13px;">Ask your AI assistant a code question — it should call <code>analyze_files</code> or <code>analyze_workspace</code>, and stats will appear here.</div></div>';
        footer.innerHTML = 'Waiting for first MCP call...';
        return;
      }

      var maxLangSaved = Math.max.apply(null, Object.values(a.byLanguage).map(function(l) { return l.saved; }));

      var html = '';

      // Hero card
      html += '<div class="grid">';
      html += '<div class="card hero"><div class="label">Total Tokens Saved</div>';
      html += '<div class="value">' + fmtNum(a.totalSaved) + '</div>';
      html += '<div class="meta">' + a.reductionPercent + '% reduction · ' + fmtNum(a.totalOriginalTokens) + ' → ' + fmtNum(a.totalCompactedTokens) + ' tokens</div></div>';
      html += '</div>';

      // Stat cards row
      html += '<div class="grid">';
      html += '<div class="card"><div class="label">Tokens Processed</div><div class="value">' + fmtNum(a.totalOriginalTokens) + '</div><div class="meta">total input tokens analyzed</div></div>';
      html += '<div class="card"><div class="label">Est. Cost Saved</div><div class="value cost-highlight">' + esc(a.estimatedCost.label) + '</div><div class="meta">GPT-4o $' + a.estimatedCost.gpt4o.toFixed(2) + ' · Sonnet $' + a.estimatedCost.claudeSonnet.toFixed(2) + '</div></div>';
      html += '<div class="card"><div class="label">Avg Saved / File</div><div class="value highlight">' + fmtNum(a.avgSavedPerFile) + '</div><div class="meta">tokens per unique file</div></div>';
      html += '<div class="card"><div class="label">Unique Files</div><div class="value">' + fmtNum(a.uniqueFiles) + '</div><div class="meta">' + fmtNum(a.totalAnalyses) + ' total analyses</div></div>';
      html += '<div class="card"><div class="label">MCP Calls</div><div class="value">' + fmtNum(a.totalCalls) + '</div><div class="meta">last: ' + fmtRelTime(a.lastCall) + '</div></div>';
      html += '<div class="card"><div class="label">Reduction</div><div class="value highlight">' + a.reductionPercent + '%</div><div class="meta">avg token compaction</div></div>';

      // This-month card (budgets roll monthly)
      var nowKey = new Date().toISOString().slice(0, 7);
      var curMonth = (a.byMonth || []).find(function(m) { return m.month === nowKey; });
      if (curMonth) {
        html += '<div class="card"><div class="label">This Month</div><div class="value highlight">' + fmtNum(curMonth.saved) + '</div>';
        html += '<div class="meta">' + fmtNum(curMonth.analyses) + ' analyses · ' + fmtNum(curMonth.calls) + ' calls · ' + esc(curMonth.estimatedCost.label) + ' saved</div>';
        if (a.monthlyAnalysisBudget > 0) {
          var budgetPct = Math.min(100, Math.round((curMonth.analyses / a.monthlyAnalysisBudget) * 100));
          var overBudget = curMonth.analyses > a.monthlyAnalysisBudget;
          html += '<div class="meta" style="margin-top:6px;">Budget: ' + fmtNum(curMonth.analyses) + ' / ' + fmtNum(a.monthlyAnalysisBudget) + ' analyses'
            + (overBudget ? ' <span style="color:var(--red);">over</span>' : '') + '</div>';
          html += '<div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;overflow:hidden;">';
          html += '<div style="height:100%;width:' + budgetPct + '%;background:' + (overBudget ? 'var(--red)' : 'var(--accent)') + ';border-radius:2px;"></div></div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // Sparkline
      if (a.timeline && a.timeline.length >= 2) {
        html += '<div class="sparkline-container">';
        html += '<div class="sparkline-header"><h2>Savings Over Time</h2>';
        html += '<span class="sparkline-total">cumulative: ' + fmtNum(a.totalSaved) + ' tokens</span></div>';
        html += '<canvas id="sparkCanvas" width="800" height="80"></canvas>';
        html += '</div>';
      }

      // Monthly breakdown (newest first)
      if (a.byMonth && a.byMonth.length > 0) {
        var maxMonthSaved = Math.max.apply(null, a.byMonth.map(function(m) { return m.saved; })) || 1;
        html += '<div class="section"><h2>📅 Monthly Breakdown</h2><table>';
        html += '<thead><tr><th>Month</th><th class="num">Analyses</th><th class="num">Calls</th><th class="num">Files</th><th class="num">Tokens Saved</th><th class="num">Reduction</th><th class="num">Est. Cost Saved</th><th class="num">vs Prev</th><th></th></tr></thead><tbody>';
        for (var mi = 0; mi < Math.min(a.byMonth.length, 12); mi++) {
          var mo = a.byMonth[mi];
          var isCur = mo.month === nowKey;
          var mw = Math.max(2, Math.round((mo.saved / maxMonthSaved) * 140));
          var momLabel = mo.momSavedDelta != null
            ? formatMomDelta(mo.momSavedDelta, mo.momSavedPercent)
            : '—';
          html += '<tr' + (isCur ? ' style="background:color-mix(in srgb, var(--accent) 6%, transparent);"' : '') + '>';
          html += '<td><strong>' + esc(fmtMonthLabel(mo.month)) + '</strong>' + (isCur ? ' <span style="font-size:10px;color:var(--accent);text-transform:uppercase;">current</span>' : '') + '</td>';
          html += '<td class="num">' + fmtNum(mo.analyses) + '</td>';
          html += '<td class="num">' + fmtNum(mo.calls) + '</td>';
          html += '<td class="num">' + fmtNum(mo.uniqueFiles) + '</td>';
          html += '<td class="num">' + fmtNum(mo.saved) + '</td>';
          html += '<td class="num pct">' + mo.reductionPercent + '%</td>';
          html += '<td class="num" style="color:var(--yellow);">' + esc(mo.estimatedCost.label) + '</td>';
          html += '<td class="num" style="font-size:11px;color:var(--muted);">' + esc(momLabel) + '</td>';
          html += '<td><span class="bar" style="width:' + mw + 'px;"></span></td></tr>';
        }
        html += '</tbody></table></div>';
      }

      // Language table
      var langs = Object.entries(a.byLanguage).sort(function(x, y) { return y[1].saved - x[1].saved; });
      if (langs.length > 0) {
        html += '<div class="section"><h2>By Language</h2><table>';
        html += '<thead><tr><th>Language</th><th class="num">Files</th><th class="num">Original</th><th class="num">Compacted</th><th class="num">Tokens Saved</th><th class="num">Reduction</th><th></th></tr></thead><tbody>';
        for (var li = 0; li < langs.length; li++) {
          var name = langs[li][0];
          var s = langs[li][1];
          var w = maxLangSaved > 0 ? Math.max(2, Math.round((s.saved / maxLangSaved) * 140)) : 0;
          html += '<tr><td><strong>' + esc(name) + '</strong></td>';
          html += '<td class="num">' + fmtNum(s.files) + '</td>';
          html += '<td class="num">' + fmtNum(s.original) + '</td>';
          html += '<td class="num">' + fmtNum(s.compacted) + '</td>';
          html += '<td class="num">' + fmtNum(s.saved) + '</td>';
          html += '<td class="num pct">' + s.reductionPercent + '%</td>';
          html += '<td><span class="bar" style="width:' + w + 'px;"></span></td></tr>';
        }
        html += '</tbody></table></div>';
      }

      // Top savers
      if (a.topSavers.length > 0) {
        html += '<div class="section"><h2>Top Savers</h2><table>';
        html += '<thead><tr><th>File</th><th>Language</th><th class="num">Tokens Saved</th><th class="num">Reduction</th></tr></thead><tbody>';
        for (var ti = 0; ti < a.topSavers.length; ti++) {
          var t = a.topSavers[ti];
          html += '<tr><td class="file">' + esc(shortPath(t.filePath, 70)) + '</td>';
          html += '<td>' + esc(t.language) + '</td>';
          html += '<td class="num">' + fmtNum(t.saved) + '</td>';
          html += '<td class="num pct">' + t.reductionPercent + '%</td></tr>';
        }
        html += '</tbody></table></div>';
      }

      // Recent activity
      if (a.recentActivity.length > 0) {
        html += '<div class="section"><h2>Recent Activity</h2><table>';
        html += '<thead><tr><th>When</th><th>Tool</th><th>File</th><th class="num">Original</th><th class="num">Compacted</th><th class="num">Saved</th></tr></thead><tbody>';
        for (var ri = 0; ri < Math.min(a.recentActivity.length, 15); ri++) {
          var ra = a.recentActivity[ri];
          var saved = ra.originalTokens - ra.compactedTokens;
          html += '<tr><td>' + fmtRelTime(ra.timestamp) + '</td>';
          html += '<td><code>' + esc(ra.tool) + '</code></td>';
          html += '<td class="file">' + esc(shortPath(ra.filePath, 60)) + '</td>';
          html += '<td class="num">' + fmtNum(ra.originalTokens) + '</td>';
          html += '<td class="num">' + fmtNum(ra.compactedTokens) + '</td>';
          html += '<td class="num pct">' + fmtNum(saved) + '</td></tr>';
        }
        html += '</tbody></table></div>';
      }

      root.innerHTML = html;

      // Draw sparkline after DOM is updated
      if (a.timeline && a.timeline.length >= 2) {
        drawSparkline('sparkCanvas', a.timeline);
      }

      footer.innerHTML = '<span>First call: ' + fmtRelTime(a.firstCall) + ' · Last call: ' + fmtRelTime(a.lastCall) + '</span>'
        + '<span>Stats file: ' + esc(a.firstCall ? '~/.tokenslayer/stats.jsonl' : '') + '</span>';
    }

    document.getElementById('exportBtn').addEventListener('click', function() {
      window.open('/api/export', '_blank');
    });
    document.getElementById('exportCsvBtn').addEventListener('click', function() {
      window.open('/api/export/monthly.csv', '_blank');
    });

    render().catch(function(e) {
      document.getElementById('root').innerHTML = '<div class="empty"><div class="icon">⚠️</div>Failed to load stats: ' + e.message + '</div>';
    });
    setInterval(render, 5000);
  </script>
</body>
</html>`;
}
