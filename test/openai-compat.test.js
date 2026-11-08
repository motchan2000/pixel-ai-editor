// OpenAI 互換のモックサーバーを立てて generateRough を通しで確認する
const http = require('http');
const assert = require('assert');
const { generateRough } = require('../ai');

const art = { palette: { a: '#ff0000' }, rows: Array.from({ length: 16 }, (_, y) => (y === 8 ? 'a'.repeat(16) : '.'.repeat(16))) };
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    seen.push({ url: req.url, auth: req.headers.authorization, rf: !!j.response_format, mct: 'max_completion_tokens' in j });
    // response_format を拒否するサーバーを模擬（1回目は 400）
    if (j.response_format) { res.writeHead(400); return res.end('{"error":"response_format unsupported"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(art) + '\n```' } }] }));
  });
});
server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}/v1/`;
  try {
    const r = await generateRough({ cfg: { protocol: 'openai', baseUrl: base, model: 'm', apiKey: 'k' }, prompt: 'x', size: 16 });
    assert.strictEqual(r.pixels[8 * 16], '#ff0000');
    assert.strictEqual(seen[0].url, '/v1/chat/completions');
    assert.strictEqual(seen[0].auth, 'Bearer k');
    assert.ok(seen[0].rf && !seen[1].rf, 'response_format なしで再試行していない');
    // キーなし（ローカル）は Authorization を付けない
    seen.length = 0;
    await generateRough({ cfg: { protocol: 'openai', baseUrl: base, model: 'm', apiKey: '' }, prompt: 'x', size: 16 });
    assert.strictEqual(seen[0].auth, undefined);
    // 接続できない URL はわかりやすいエラー
    await assert.rejects(generateRough({ cfg: { protocol: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, prompt: 'x', size: 16 }), /接続できませんでした/);
    console.log('openai-compat tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});
