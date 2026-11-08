// MCP クライアントとして mcp-server.mjs を起動し、ツールを一通り呼ぶ
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp-server.mjs'], stderr: 'inherit' }));
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  console.log(`> ${name}${r.isError ? ' [ERROR]' : ''}:`, t.slice(0, 200).replace(/\s+/g, ' '));
  return r;
};

await call('open_editor');
await call('new_canvas', { size: 16 });
// スライム
await call('draw_rows', {
  palette: { o: '#1a1c2c', g: '#38b764', l: '#a7f070', d: '#257179', w: '#ffffff' },
  rows: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oollggoo....',
    '...ollllgggo....',
    '..olwwlggwwgo...',
    '..olwolggwogo...',
    '.olllgggggggdo..',
    '.ollggggggggdo..',
    '.oggggggggggddo.',
    '.ogggggggggddo..',
    '..oddddddddoo...',
    '...oooooooo.....',
    '................',
  ],
});
await call('draw_rect', { x1: 0, y1: 15, x2: 15, y2: 15, color: '#5d275d', filled: true });
await call('set_pixels', { pixels: [{ x: 6, y: 11, color: '#1a1c2c' }, { x: 7, y: 11, color: '#1a1c2c' }] });
await call('fill', { x: 0, y: 0, color: '#29366f' });
await call('undo');
await call('draw_line', { x1: 99, y1: 0, x2: 0, y2: 0, color: 'red' }); // 色エラーの確認
const out = path.join(os.tmpdir(), 'pixel-mcp-test.png');
await call('export_png', { path: out, scale: 8 });
console.log('png exists:', fs.existsSync(out), fs.statSync(out).size, 'bytes');
const g = await call('get_canvas');
const img = g.content.find((c) => c.type === 'image');
console.log('image returned:', !!img, img ? img.data.length : 0);
if (img) fs.writeFileSync(process.argv[2] || 'canvas.png', Buffer.from(img.data, 'base64'));
await client.close();
