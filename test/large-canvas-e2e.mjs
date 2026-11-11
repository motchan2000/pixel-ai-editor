// 大きいキャンバス（128〜512px）を MCP 経由で一通り操作する
// 使い方: node test/large-canvas-e2e.mjs [出力フォルダ]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = process.argv[2] || os.tmpdir();
const client = new Client({ name: 'e2e-large', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp-server.mjs'], stderr: 'inherit' }));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  console.log(`> ${name}${r.isError ? ' [ERROR]' : ''}:`, t.slice(0, 160).replace(/\s+/g, ' '));
  if (r.isError) throw new Error(t);
  return { r, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};

await call('open_editor');
for (const size of [128, 256, 512]) {
  await call('new_canvas', { size });
  const info = (await call('get_canvas', { include_image: false })).json;
  assert.strictEqual(info.size, size);
  assert.ok(!info.rows, '64px 超の全体取得では rows を省略する');
}

// 512px: 右下端まで描けること、範囲取得できること
await call('draw_rect', { x1: 0, y1: 0, x2: 511, y2: 511, color: '#1a1c2c' });
await call('draw_line', { x1: 0, y1: 0, x2: 511, y2: 511, color: '#ff004d' });
await call('fill', { x: 300, y: 100, color: '#29366f' });
// 色数が CHARS を超えるケース（200色）
const pixels = [];
for (let i = 0; i < 200; i++) pixels.push({ x: 100 + (i % 20), y: 400 + Math.floor(i / 20), color: '#' + (0x102030 + i * 0x010307).toString(16).padStart(6, '0').slice(-6) });
await call('set_pixels', { pixels });
const part = (await call('get_canvas', { x: 100, y: 400, w: 20, h: 10, include_image: false })).json;
assert.strictEqual(part.rows.length, 10);
assert.strictEqual([...part.rows[0]].length, 20);
assert.strictEqual(Object.keys(part.palette).length, 200);
const corner = (await call('get_canvas', { x: 508, y: 508, w: 10, h: 10, include_image: false })).json;
assert.deepStrictEqual(corner.region, { x: 508, y: 508, w: 4, h: 4 });
assert.strictEqual([...corner.rows[3]][3], Object.keys(corner.palette).find((k) => corner.palette[k] === '#ff004d'));

// 文字グリッドで部分描画（x, y 指定）
await call('draw_rows', { x: 480, y: 10, palette: { a: '#ffcd75' }, rows: ['aaaa', 'a..a', 'aaaa'] });

const png = path.join(outDir, 'large-512.png');
await call('export_png', { path: png, scale: 1 });
const big = path.join(outDir, 'large-512-x32.png');
await call('export_png', { path: big, scale: 32 }); // 8192px に制限される
const head = fs.readFileSync(big);
assert.strictEqual(head.readUInt32BE(16), 8192, '書き出しは一辺 8192px まで');
console.log('png:', fs.statSync(png).size, 'bytes / x32 clamped width:', head.readUInt32BE(16));

const g = await call('get_canvas');
const img = g.r.content.find((c) => c.type === 'image');
assert.ok(img, '画像が返る');
fs.writeFileSync(path.join(outDir, 'large-512-preview.png'), Buffer.from(img.data, 'base64'));

await call('undo');
await call('redo');
await client.close();
console.log('large canvas e2e passed');
