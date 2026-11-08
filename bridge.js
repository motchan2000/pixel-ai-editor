// MCPサーバー(mcp-server.mjs)からの命令を受け取るローカルHTTP窓口。
// 127.0.0.1 のみで待ち受け、起動ごとにランダムなトークンで認証する。
// ポートとトークンは userData/bridge.json に書き出し、MCPサーバーがそれを読む。
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function startBridge({ app, handle }) {
  const token = crypto.randomBytes(24).toString('hex');
  const infoPath = path.join(app.getPath('userData'), 'bridge.json');

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST' || req.url !== '/call') return send(404, { ok: false, error: 'not found' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { ok: false, error: 'unauthorized' });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const { tool, args } = JSON.parse(body || '{}');
        const result = await handle(String(tool), args || {});
        send(200, { ok: true, result });
      } catch (e) {
        send(200, { ok: false, error: e.message || String(e) });
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify({ port, token, pid: process.pid }));
  });

  const cleanup = () => {
    try {
      const cur = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      if (cur.token === token) fs.unlinkSync(infoPath);
    } catch { /* ignore */ }
  };
  app.on('will-quit', () => { cleanup(); server.close(); });

  return {
    status: () => {
      const a = server.address();
      return a ? { listening: true, port: a.port } : { listening: false };
    },
  };
}

module.exports = { startBridge };
