// UI結線
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let roughPalette = [];
let recent = [];
let lastRough = null;

const editor = new PixelEditor($('#canvas'), {
  onChange: () => renderPalette(),
  onPick: (c) => { setColor(c); setTool('pen'); },
  onColorUsed: (c) => pushRecent(c),
});

// ---------- 色 ----------
function setColor(c) {
  editor.color = c;
  $('#color').value = c;
  $('#color-hex').textContent = c;
  renderPalette();
  renderRecent();
}
function pushRecent(c) {
  recent = [c, ...recent.filter((x) => x !== c)].slice(0, 16);
  renderRecent();
}
function swatch(c) {
  const b = document.createElement('button');
  b.style.background = c;
  b.title = c;
  if (c === editor.color) b.classList.add('active');
  b.onclick = () => setColor(c);
  return b;
}
function renderPalette() {
  const colors = [...new Set([...roughPalette, ...editor.usedColors()])];
  $('#palette').replaceChildren(...colors.map(swatch));
}
function renderRecent() {
  $('#recent').replaceChildren(...recent.map(swatch));
}
$('#color').addEventListener('input', (e) => setColor(e.target.value));

// ---------- ツール ----------
function setTool(t) {
  editor.tool = t;
  $$('.tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
$$('.tools [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$('#btn-undo').onclick = () => editor.undo();
$('#btn-redo').onclick = () => editor.redo();
$('#btn-clear').onclick = () => { if (confirm('キャンバスを全消去しますか？（元に戻せます）')) editor.clear(); };
$('#btn-flip').onclick = () => editor.flipH();
$$('[data-shift]').forEach((b) => (b.onclick = () => {
  const [dx, dy] = b.dataset.shift.split(',').map(Number);
  editor.shift(dx, dy);
}));
$('#chk-grid').onchange = (e) => { editor.showGrid = e.target.checked; editor.render(); };
$('#chk-mirror').onchange = (e) => { editor.mirrorX = e.target.checked; editor.render(); };

// 座標表示
$('#canvas').addEventListener('pointermove', () => {
  const h = editor.hover;
  $('#coords').textContent = h ? `x:${h.x}  y:${h.y}` : '';
});

// ---------- サイズ ----------
function setSizeButtons(size) {
  $$('.size-select button').forEach((b) => b.classList.toggle('active', +b.dataset.size === size));
}
function resetForSize(size) {
  roughPalette = [];
  lastRough = null;
  editor.underlay = null;
  $('#rough-actions').classList.add('hidden');
  editor.setSize(size);
  setSizeButtons(size);
}
$$('.size-select button').forEach((b) => (b.onclick = () => {
  const size = +b.dataset.size;
  if (size === editor.size) return;
  if (editor.usedColors().length && !confirm(`${size}×${size} に変更すると現在の絵は消えます。よろしいですか？`)) return;
  resetForSize(size);
}));

// ---------- キーボード ----------
window.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea, input[type=text], input[type=password], input[type=number]')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); return; }
  if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); return; }
  if (e.ctrlKey && k === 's') { e.preventDefault(); saveProject(); return; }
  if (e.ctrlKey) return;
  const map = { b: 'pen', p: 'pen', e: 'eraser', g: 'fill', i: 'picker', l: 'line', r: 'rect' };
  if (map[k]) setTool(map[k]);
  if (k === 'm') { $('#chk-mirror').click(); }
});

// ---------- AI生成 ----------
function setStatus(el, text, cls = '') {
  el.textContent = text;
  el.className = 'status ' + cls;
}

$('#btn-generate').onclick = async () => {
  const prompt = $('#prompt').value.trim();
  if (!prompt) { setStatus($('#gen-status'), 'お題を入力してください', 'error'); return; }
  const size = editor.size;
  const maxColors = Math.max(2, Math.min(32, +$('#max-colors').value || 12));
  const btn = $('#btn-generate');
  btn.disabled = true;
  const t0 = Date.now();
  setStatus($('#gen-status'), `${size}×${size} を生成中…${size === 64 ? '（64は1分ほどかかることがあります）' : ''}`, 'busy');
  const res = await window.api.generate({ prompt, size, maxColors });
  btn.disabled = false;
  if (!res.ok) { setStatus($('#gen-status'), res.error, 'error'); return; }
  if (editor.size !== size) { setStatus($('#gen-status'), '生成中にサイズが変更されたため破棄しました', 'error'); return; }

  applyRough(res.result.pixels, res.result.palette,
    `完了（${((Date.now() - t0) / 1000).toFixed(1)}秒・${res.result.palette.length}色）。自由に手直ししてください。`);
};

function applyRough(pixels, palette, message) {
  lastRough = pixels;
  roughPalette = palette;
  editor.underlay = lastRough;
  editor.replaceAll(lastRough); // Ctrl+Z で元に戻せる
  if (roughPalette[0]) setColor(roughPalette[0]);
  showRoughThumb();
  setStatus($('#gen-status'), message, 'ok');
}

function showRoughThumb() {
  const n = editor.size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const cx = cv.getContext('2d');
  lastRough.forEach((c, i) => { if (c) { cx.fillStyle = c; cx.fillRect(i % n, (i / n) | 0, 1, 1); } });
  $('#rough-thumb').src = cv.toDataURL();
  $('#rough-actions').classList.remove('hidden');
}
$('#btn-apply-rough').onclick = () => { if (lastRough) editor.replaceAll(lastRough); };
$('#chk-underlay').onchange = (e) => { editor.showUnderlay = e.target.checked; editor.render(); };
$('#underlay-opacity').oninput = (e) => { editor.underlayOpacity = e.target.value / 100; editor.render(); };

// ---------- ファイル ----------
$('#btn-export').onclick = async () => {
  const scale = +$('#export-scale').value;
  const name = `pixel_${editor.size}${scale > 1 ? '_x' + scale : ''}.png`;
  const r = await window.api.savePng(editor.toDataURL(scale), name);
  if (r.ok) setStatus($('#gen-status'), `保存しました: ${r.filePath}`, 'ok');
};

async function saveProject() {
  const json = JSON.stringify({
    format: 'pixel-ai-editor', version: 1,
    size: editor.size, pixels: editor.pixels, roughPalette,
  });
  const r = await window.api.saveProject(json, `pixel_${editor.size}.pxa.json`);
  if (r.ok) setStatus($('#gen-status'), `保存しました: ${r.filePath}`, 'ok');
}
$('#btn-save-proj').onclick = saveProject;

$('#btn-open').onclick = async () => {
  const r = await window.api.openProject();
  if (!r.ok) return;
  try {
    const d = JSON.parse(r.json);
    if (![16, 32, 64].includes(d.size) || !Array.isArray(d.pixels) || d.pixels.length !== d.size * d.size) throw new Error();
    roughPalette = d.roughPalette || [];
    lastRough = null;
    editor.underlay = null;
    $('#rough-actions').classList.add('hidden');
    editor.setSize(d.size, d.pixels.map((c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null)));
    setSizeButtons(d.size);
  } catch {
    alert('プロジェクトファイルを読み込めませんでした');
  }
};

// ---------- APIキー ----------
async function refreshKeyStatus() {
  const s = await window.api.settingsStatus();
  const msg = s.source === 'settings' ? '設定済み（アプリに保存）' : s.source === 'env' ? '設定済み（.env から読み込み）' : '未設定です。DeepSeekのAPIキーを入力してください';
  setStatus($('#key-status'), msg, s.hasKey ? 'ok' : 'error');
}
$('#btn-save-key').onclick = async () => {
  await window.api.setApiKey($('#api-key').value);
  $('#api-key').value = '';
  refreshKeyStatus();
};

// ---------- MCP 登録用の設定をコピー ----------
$('#btn-copy-mcp-code').onclick = async () => {
  const c = await window.api.mcpConfig();
  const envs = Object.entries(c.env).map(([k, v]) => `-e ${k}=${v} `).join('');
  const cmd = `claude mcp add pixel-editor -s user ${envs}-- "${c.command}" ${c.args.map((a) => `"${a}"`).join(' ')}`;
  await window.api.copy(cmd);
  setStatus($('#mcp-copy-status'), 'コピーしました。ターミナルに貼り付けて実行してください。', 'ok');
};
$('#btn-copy-mcp-desktop').onclick = async () => {
  const c = await window.api.mcpConfig();
  const json = JSON.stringify({ mcpServers: { 'pixel-editor': c } }, null, 2);
  await window.api.copy(json);
  setStatus($('#mcp-copy-status'), 'コピーしました。%APPDATA%\\Claude\\claude_desktop_config.json の mcpServers に追記してください。', 'ok');
};

// ---------- MCP (renderer/mcp.js) から使う関数 ----------
window.appResetForSize = resetForSize;
window.appApplyRough = applyRough;
window.appSetGenStatus = (text, cls) => setStatus($('#gen-status'), text, cls);

// ---------- 起動 ----------
editor.setSize(16);
setColor('#000000');
refreshKeyStatus();
