import { createServer, type Server } from "node:http";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

export function startViewer(port: number, logFilePath: string, onError?: (err: Error) => void): Server {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/logs") {
        const raw = Number(url.searchParams.get("offset") ?? "0");
        const offset = Number.isFinite(raw) && raw >= 0 ? raw : 0;
        const { nextOffset, data } = readFrom(logFilePath, offset);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nextOffset, data }));
        return;
      }

      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAGE_HTML);
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error");
    }
  });

  // Never let a bind/listen failure crash the process. EADDRINUSE (a second
  // Claude Code session reusing the port) is the common case; the shared log
  // file still records everything, and the process that owns the port serves
  // it for everyone.
  server.on("error", (err: Error) => {
    if (onError) onError(err);
  });

  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

function readFrom(path: string, offset: number): { nextOffset: number; data: string } {
  if (!existsSync(path)) return { nextOffset: 0, data: "" };
  const size = statSync(path).size;
  let start = offset;
  if (start > size) start = 0;
  if (start >= size) return { nextOffset: size, data: "" };

  const length = size - start;
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return { nextOffset: size, data: buf.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>claude-delegate logs</title>
<style>
  body { font: 13px/1.5 ui-monospace, Menlo, monospace; margin: 0; background: #0b0e14; color: #cbd5e1; }
  header { position: sticky; top: 0; background: #11151f; padding: 8px 12px; border-bottom: 1px solid #1f2733; display: flex; gap: 12px; align-items: center; }
  select { background: #0b0e14; color: #cbd5e1; border: 1px solid #2a3446; padding: 3px 6px; }
  #log { padding: 8px 12px; }
  .row { display: grid; grid-template-columns: 70px 48px 130px 130px 1fr; gap: 8px; padding: 1px 0; white-space: pre-wrap; word-break: break-word; }
  .row.warn { color: #fbbf24; }
  .row.error { color: #f87171; }
  .t { color: #64748b; } .l { text-transform: uppercase; } .s { color: #7dd3fc; } .e { color: #a5b4fc; }
</style>
</head>
<body>
<header>
  <strong>claude-delegate logs</strong>
  <label>session:
    <select id="session-filter">
      <option value="__all__">all</option>
      <option value="__none__">— (no session)</option>
    </select>
  </label>
</header>
<div id="log"></div>
<script>
  let offset = 0;
  const seen = new Set();
  const rows = [];
  const logEl = document.getElementById('log');
  const filterEl = document.getElementById('session-filter');
  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function shortSid(s){ return s ? s.slice(0,10) : '—'; }
  function render(){
    const sel = filterEl.value;
    const atBottom = Math.abs(logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight) < 40;
    logEl.innerHTML = rows.filter(r =>
      sel === '__all__' || (sel === '__none__' && !r.sid) || r.sid === sel
    ).map(r => r.html).join('');
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  }
  function addRow(e){
    const sid = e.session_id || null;
    if (sid && !seen.has(sid)) {
      seen.add(sid);
      const opt = document.createElement('option');
      opt.value = sid; opt.textContent = sid.slice(0,16);
      filterEl.appendChild(opt);
    }
    const details = [
      e.msg, e.status,
      e.job_id ? 'job=' + e.job_id.slice(0,8) : '',
      e.working_directory,
      e.duration_ms != null ? e.duration_ms + 'ms' : '',
      e.cost != null ? '$' + e.cost : '',
      e.error ? 'err: ' + e.error : ''
    ].filter(Boolean).join(' · ');
    rows.push({ sid, html:
      '<div class="row ' + esc(e.level) + '">' +
      '<span class="t">' + esc((e.ts||'').slice(11,19)) + '</span>' +
      '<span class="l">' + esc(e.level||'') + '</span>' +
      '<span class="s">' + esc(shortSid(sid)) + '</span>' +
      '<span class="e">' + esc(e.event||'') + '</span>' +
      '<span class="d">' + esc(details) + '</span></div>'
    });
  }
  async function poll(){
    try {
      const res = await fetch('/logs?offset=' + offset);
      const { nextOffset, data } = await res.json();
      offset = nextOffset;
      if (data) {
        for (const line of data.split('\\n')) {
          if (!line.trim()) continue;
          let e; try { e = JSON.parse(line); } catch { continue; }
          addRow(e);
        }
        render();
      }
    } catch {}
  }
  filterEl.addEventListener('change', render);
  setInterval(poll, 1500);
  poll();
</script>
</body>
</html>`;
