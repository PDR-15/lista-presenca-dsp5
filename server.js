// Lista de Presenca - servidor local sem dependencias. Uso: node server.js <porta> <pin> <state.json>
const http = require('http'), fs = require('fs'), path = require('path');
const os = require('os');
const PORT = parseInt(process.env.PORT || process.argv[2] || '3000', 10);
const PIN = String(process.env.PIN || process.argv[3] || '0000');
const STATE_FILE = process.argv[4] || path.join(os.tmpdir(), 'presenca-state.json');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let state = { date: '', updatedAt: new Date().toISOString(), rows: [] };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
const clients = new Set();
function save() { state.updatedAt = new Date().toISOString(); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); }
function broadcast() { const d = 'data: ' + JSON.stringify(state) + '\n\n'; for (const c of clients) c.write(d); }
function nowHM() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); }
function body(req) { return new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }
function json(res, code, o) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(HTML);
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  const pin = req.headers['x-pin'] || url.searchParams.get('pin');
  if (pin !== PIN) return json(res, 401, { error: 'PIN invalido' });
  if (url.pathname === '/api/state') return json(res, 200, state);
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(state) + '\n\n'); clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 20000);
    req.on('close', () => { clients.delete(res); clearInterval(ka); }); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/update') {
    const b = await body(req); const row = state.rows.find(r => r.id === b.id);
    if (!row) return json(res, 404, { error: 'linha nao encontrada' });
    if ('status' in b) {
      const s = ['presente', 'atrasado', ''].includes(b.status) ? b.status : '';
      if (s !== row.status) { row.status = s; row.marcadoEm = s ? nowHM() : ''; }
    }
    if ('obs' in b) row.obs = String(b.obs).slice(0, 500);
    save(); broadcast(); return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/load') {
    const b = await body(req);
    if (!Array.isArray(b.rows)) return json(res, 400, { error: 'rows invalido' });
    state = { date: String(b.date || ''), updatedAt: new Date().toISOString(), rows: b.rows.slice(0, 500) };
    save(); broadcast(); return json(res, 200, { ok: true, n: state.rows.length });
  }
  if (req.method === 'POST' && url.pathname === '/api/add') {
    const b = await body(req); const nome = String(b.nome || '').trim().slice(0, 100);
    if (!nome) return json(res, 400, { error: 'nome vazio' });
    state.rows.push({ id: 'x' + Date.now(), rota: String(b.rota || '').slice(0, 20), hora: String(b.hora || ''), dsp: String(b.dsp || '').slice(0, 20), nome, reserva: !b.rota, status: '', marcadoEm: '', obs: '' });
    save(); broadcast(); return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, '0.0.0.0', () => console.log('LISTENING ' + PORT));
