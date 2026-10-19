// A fake endpoint for the Hello sample extension. Node 18+, no packages.
// Run: node examples/extensions/hello/server.mjs  (port 8787, or PORT=...)
// Then add http://localhost:8787 in Zoggyfin: Settings, Extensions.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT || 8787);
const base = process.env.BASE_URL || `http://localhost:${port}`;
const manifest = JSON.parse(readFileSync(new URL('./zoggyfin-extension.json', import.meta.url), 'utf8'));
manifest.baseUrl = base;
const panel = readFileSync(new URL('./panel.html', import.meta.url), 'utf8');

const tasks = new Map(); // id -> { started, title }
let seq = 0;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    // A sample: any origin. A real extension lists the app's web origins.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Emby-Token, X-Jellyfin-Server-Url, X-Jellyfin-Server-Id, X-Jellyfin-User-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, base);
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  if (url.pathname === '/zoggyfin-extension.json') return send(res, 200, manifest);
  if (url.pathname === '/moods') return send(res, 200, { options: [{ value: 'happy', label: 'Happy' }, { value: 'calm', label: 'Calm' }] });
  if (url.pathname === '/greet' && req.method === 'POST') {
    const b = await readBody(req);
    const id = String(++seq);
    tasks.set(id, { started: Date.now(), title: `${b.greeting || 'Hello'} ${b.name || 'item'}` });
    return send(res, 200, { toast: `${b.greeting || 'Hello'}, ${b.user || 'friend'}! (${b.mood})`, task: { id, title: `Counting for ${b.name}`, statusUrl: `/tasks/${id}`, intervalSeconds: 1 } });
  }
  const t = /^\/tasks\/(\d+)$/.exec(url.pathname);
  if (t) {
    const task = tasks.get(t[1]);
    if (!task) return send(res, 404, { error: 'No such task' });
    const p = Math.min(1, (Date.now() - task.started) / 10000);
    return send(res, 200, p < 1 ? { state: 'running', progress: p } : { state: 'done', toast: `${task.title}: done`, refresh: 'none' });
  }
  if (url.pathname === '/share' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, { toast: `Hello got ${b.url}` });
  }
  if (url.pathname === '/feed') {
    return send(res, 200, {
      items: [
        { id: 'a', title: 'First card', subtitle: 'A plain card', progress: 0.3 },
        { id: 'b', title: 'Open the page', subtitle: 'Opens the panel', panel: 'main' },
        { id: 'c', title: 'A link', subtitle: 'Opens the browser', link: 'https://jellyfin.org' },
      ],
    });
  }
  if (url.pathname === '/panel') return send(res, 200, panel, 'text/html; charset=utf-8');
  send(res, 404, { error: 'Not found' });
}).listen(port, () => console.log(`Hello extension on ${base}`));
