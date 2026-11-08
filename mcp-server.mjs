#!/usr/bin/env node
// Pixel AI Editor の MCP サーバー（stdio）。
// Claude などの MCP クライアントからのツール呼び出しを、起動中のエディタアプリへ中継する。
// アプリが起動していなければ自動で起動する。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const log = (...a) => console.error('[pixel-mcp]', ...a); // stdout は MCP 通信専用

function userDataDir() {
  const name = 'pixel-ai-editor';
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}
const BRIDGE_FILE = path.join(userDataDir(), 'bridge.json');

function readBridge() {
  try { return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8')); } catch { return null; }
}

async function rawCall(info, tool, args) {
  const res = await fetch(`http://127.0.0.1:${info.port}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` },
    body: JSON.stringify({ tool, args }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'エディタ側でエラーが発生しました');
  return json.result;
}

function launchApp() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let exe, args;
  if (process.versions.electron && !fs.existsSync(path.join(APP_DIR, 'node_modules', 'electron', 'dist'))) {
    // インストール版: このスクリプトはアプリの exe（ELECTRON_RUN_AS_NODE=1）で動いている
    exe = process.execPath;
    args = [];
  } else {
    // 開発版: node_modules の electron でソースフォルダを起動
    exe = require('electron'); // node から require すると exe のパスが返る
    args = [APP_DIR];
  }
  log('エディタを起動します:', exe);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: APP_DIR, env });
  child.unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let launching = null;
async function connect() {
  const info = readBridge();
  if (info) {
    try { await rawCall(info, 'get_info', {}); return info; } catch { /* 古い bridge.json */ }
  }
  if (!launching) {
    launching = (async () => {
      launchApp();
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const inf = readBridge();
        if (!inf) continue;
        try { await rawCall(inf, 'get_info', {}); return inf; } catch { /* まだ準備中 */ }
      }
      throw new Error('エディタを起動できませんでした。手動で `npm start` してから再試行してください。');
    })().finally(() => { launching = null; });
  }
  return launching;
}

async function call(tool, args = {}) {
  const info = await connect();
  return rawCall(info, tool, args);
}

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const wrap = (fn) => async (args) => {
  try { return await fn(args); } catch (e) { return { ...text(`エラー: ${e.message}`), isError: true }; }
};

const color = z.string().describe('"#rrggbb" 形式の色');
const colorOrErase = z.string().nullable().describe('"#rrggbb" 形式の色。null で透明（消去）');
const coord = z.number().int().describe('ピクセル座標（左上が 0,0）');

const server = new McpServer({ name: 'pixel-ai-editor', version: '1.0.0' }, {
  instructions:
    'Pixel AI Editor（16/32/64px のドット絵エディタ）を操作します。操作は起動中のアプリに即座に反映され、ユーザーがそのまま手直しできます。' +
    'まとまった絵を描くときは draw_rows（1文字=1ピクセルの文字列グリッド＋パレット）が効率的です。' +
    '描いた後は get_canvas で画像を確認してから仕上げてください。各操作はアプリで Ctrl+Z で取り消せます。',
});

server.registerTool('open_editor', {
  title: 'エディタを開く',
  description: 'エディタアプリを起動（起動済みなら前面に表示）し、現在のサイズと使用色を返す。',
  inputSchema: {},
}, wrap(async () => {
  await call('focus');
  return text(await call('get_info'));
}));

server.registerTool('get_canvas', {
  title: 'キャンバスを取得',
  description: '現在の絵を、文字グリッド（rows + palette、"."は透明）と PNG 画像で返す。',
  inputSchema: { include_image: z.boolean().optional().describe('PNG 画像も返すか（既定 true）') },
  annotations: { readOnlyHint: true },
}, wrap(async ({ include_image = true }) => {
  const r = await call('get_canvas', { include_image });
  const content = [{ type: 'text', text: JSON.stringify({ size: r.size, palette: r.palette, rows: r.rows, legend: r.legend }, null, 1) }];
  if (r.image) content.push({ type: 'image', mimeType: 'image/png', data: r.image.replace(/^data:image\/png;base64,/, '') });
  return { content };
}));

server.registerTool('new_canvas', {
  title: '新規キャンバス',
  description: '指定サイズの空のキャンバスにする（現在の絵は消える）。',
  inputSchema: { size: z.union([z.literal(16), z.literal(32), z.literal(64)]).describe('16 / 32 / 64') },
}, wrap(async ({ size }) => text(await call('new_canvas', { size }))));

server.registerTool('draw_rows', {
  title: '文字グリッドで描く',
  description:
    '1文字=1ピクセルの文字列配列で描く。palette で文字→色を定義。"." は透明で上書き（消去）、"_" や空白はそのまま残す。' +
    'x, y を指定するとその位置を左上として部分的に描ける（既定 0,0）。キャンバス全体を描くときは size 個の size 文字の文字列を渡す。',
  inputSchema: {
    rows: z.array(z.string()).describe('各行の文字列'),
    palette: z.record(z.string(), color).describe('例: {"a":"#1a1c2c","b":"#ff004d"}'),
    x: z.number().int().optional().describe('描き始めの x（既定 0）'),
    y: z.number().int().optional().describe('描き始めの y（既定 0）'),
  },
}, wrap(async (args) => text(await call('draw_rows', args))));

server.registerTool('set_pixels', {
  title: 'ピクセルを置く',
  description: '個々のピクセルの色を設定する。細かい修正向け。',
  inputSchema: {
    pixels: z.array(z.object({ x: coord, y: coord, color: colorOrErase })).describe('設定するピクセルの一覧'),
  },
}, wrap(async (args) => text(await call('set_pixels', args))));

server.registerTool('fill', {
  title: '塗りつぶし',
  description: '指定座標と同じ色でつながった領域（上下左右）を塗りつぶす。',
  inputSchema: { x: coord, y: coord, color: colorOrErase },
}, wrap(async (args) => text(await call('fill', args))));

server.registerTool('draw_line', {
  title: '直線',
  description: '2点間に1ピクセル幅の直線を引く。',
  inputSchema: { x1: coord, y1: coord, x2: coord, y2: coord, color: colorOrErase },
}, wrap(async (args) => text(await call('line', args))));

server.registerTool('draw_rect', {
  title: '四角形',
  description: '2点を対角とする四角形を描く。filled=true で塗りつぶし。',
  inputSchema: { x1: coord, y1: coord, x2: coord, y2: coord, color: colorOrErase, filled: z.boolean().optional() },
}, wrap(async (args) => text(await call('rect', args))));

server.registerTool('clear_canvas', {
  title: '全消去',
  description: 'キャンバスを透明にする（Undo 可能）。',
  inputSchema: {},
}, wrap(async () => text(await call('clear'))));

server.registerTool('undo', { title: '元に戻す', description: '直前の操作を取り消す。', inputSchema: {} },
  wrap(async () => text(await call('undo'))));
server.registerTool('redo', { title: 'やり直し', description: '取り消した操作をやり直す。', inputSchema: {} },
  wrap(async () => text(await call('redo'))));

server.registerTool('generate_rough', {
  title: 'DeepSeek でラフ生成',
  description: 'アプリに設定された DeepSeek API でラフを生成し、キャンバスに適用する（数十秒かかることがある）。',
  inputSchema: {
    prompt: z.string().describe('描くもの（例: 赤いスライム）'),
    size: z.union([z.literal(16), z.literal(32), z.literal(64)]).optional().describe('省略時は現在のサイズ'),
    max_colors: z.number().int().min(2).max(32).optional().describe('最大色数（既定 12）'),
  },
}, wrap(async (args) => text(await call('generate_rough', args))));

server.registerTool('export_png', {
  title: 'PNG 書き出し',
  description: '現在の絵を PNG ファイルに保存する。',
  inputSchema: {
    path: z.string().describe('保存先のファイルパス（.png）'),
    scale: z.number().int().min(1).max(32).optional().describe('拡大倍率（既定 1）'),
  },
}, wrap(async (args) => text(await call('export_png', args))));

await server.connect(new StdioServerTransport());
log('ready');
