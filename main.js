const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { generateRough } = require('./deepseek');
const { startBridge } = require('./bridge');

let mainWin = null;
let bridge = null;

// productName を付けても設定や bridge.json の場所が変わらないよう固定する
// （mcp-server.mjs も %APPDATA%\pixel-ai-editor を読む）
app.setPath('userData', path.join(app.getPath('appData'), 'pixel-ai-editor'));

// MCP クライアントに登録するための起動コマンド
function mcpLaunchConfig() {
  const script = path.join(app.getAppPath(), 'mcp-server.mjs');
  if (app.isPackaged) {
    // インストール版: アプリ自身の exe を Node として動かす（Node.js 不要）
    return { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: 'node', args: [script], env: {} };
}

// ---------- 設定（APIキー） ----------
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}
// .env の DEEPSEEK_API_KEY を読む（依存パッケージなし）
function envKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = txt.match(/^\s*DEEPSEEK_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
function apiKey() {
  return readSettings().apiKey || envKey();
}

// ---------- ウィンドウ ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1e1f26',
    title: 'Pixel AI Editor',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin = win;
  win.on('closed', () => { if (mainWin === win) mainWin = null; });
}

// ---------- MCP からの命令 ----------
function rendererReady() {
  if (!mainWin) throw new Error('エディタのウィンドウが開いていません');
  const wc = mainWin.webContents;
  if (wc.isLoading()) {
    return new Promise((resolve) => wc.once('did-finish-load', () => resolve(wc)));
  }
  return Promise.resolve(wc);
}

async function callRenderer(tool, args) {
  const wc = await rendererReady();
  const r = await wc.executeJavaScript(`window.mcpHandle(${JSON.stringify(tool)}, ${JSON.stringify(args)})`, true);
  if (r && typeof r === 'object' && r.__error) throw new Error(r.__error);
  return r;
}

async function handleMcp(tool, args) {
  if (tool === 'generate_rough') {
    const info = await callRenderer('get_info', {});
    const size = args.size || info.size;
    await callRenderer('status', { text: `MCP: 「${args.prompt}」のラフを生成中…`, busy: true });
    try {
      const result = await generateRough({ apiKey: apiKey(), prompt: args.prompt, size, maxColors: args.max_colors || 12 });
      return await callRenderer('apply_rough', { prompt: args.prompt, ...result });
    } catch (e) {
      await callRenderer('status', { text: e.message, error: true });
      throw e;
    }
  }
  if (tool === 'export_png') {
    let p = String(args.path || '');
    if (!p) throw new Error('path を指定してください');
    if (!p.toLowerCase().endsWith('.png')) p += '.png';
    p = path.resolve(p);
    const dataUrl = await callRenderer('png', { scale: args.scale || 1 });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    return { saved: p };
  }
  if (tool === 'focus') {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
    return { focused: !!mainWin };
  }
  return callRenderer(tool, args);
}

// ---------- IPC ----------
ipcMain.handle('settings:status', () => {
  const k = apiKey();
  return { hasKey: !!k, source: readSettings().apiKey ? 'settings' : k ? 'env' : 'none' };
});

ipcMain.handle('settings:setKey', (_e, key) => {
  const s = readSettings();
  if (key && key.trim()) s.apiKey = key.trim(); else delete s.apiKey;
  writeSettings(s);
  return { hasKey: !!apiKey() };
});

ipcMain.handle('ai:generate', async (_e, { prompt, size, maxColors }) => {
  try {
    const result = await generateRough({ apiKey: apiKey(), prompt, size, maxColors });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('file:savePng', async (e, { dataUrl, defaultName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'pixel.png',
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return { ok: false };
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  return { ok: true, filePath };
});

ipcMain.handle('file:saveProject', async (e, { json, defaultName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName || 'pixel.pxa.json',
    filters: [{ name: 'Pixel Project', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, json);
  return { ok: true, filePath };
});

ipcMain.handle('file:openProject', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Pixel Project', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { ok: false };
  return { ok: true, json: fs.readFileSync(filePaths[0], 'utf8') };
});

ipcMain.handle('mcp:status', () => (bridge ? bridge.status() : { listening: false }));
ipcMain.handle('mcp:config', () => mcpLaunchConfig());
ipcMain.handle('clipboard:write', (_e, t) => { require('electron').clipboard.writeText(String(t)); return true; });

// 二重起動するとMCPの接続先が混乱するので1つだけにする
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  bridge = startBridge({ app, handle: handleMcp });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
