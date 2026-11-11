// ドット絵エディタ本体（キャンバス描画・ツール・Undo・ズーム/パン）
// 16〜512px に対応。表示はステージ全体を覆うキャンバスに、拡大率(cell)とオフセット(pan)で描く。
const SIZES = [16, 32, 64, 128, 256, 512];
const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

class PixelEditor {
  constructor(canvas, { onChange, onPick, onColorUsed, onView } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.onPick = onPick || (() => {});
    this.onColorUsed = onColorUsed || (() => {});
    this.onView = onView || (() => {});
    this.size = 16;
    this.pixels = new Array(16 * 16).fill(null); // '#rrggbb' or null
    this.version = 0;            // pixels を直接書き換えたら増やす（描画キャッシュ用）
    this.underlay = null;        // AIラフ（下絵）
    this.underlayOpacity = 0.4;
    this.showUnderlay = false;
    this.tool = 'pen';
    this.color = '#000000';
    this.showGrid = true;
    this.mirrorX = false;
    this.undoStack = [];
    this.redoStack = [];
    this.cell = 20;              // 1ピクセルの表示サイズ（CSS px）
    this.panX = 0;
    this.panY = 0;
    this.autoFit = true;         // ウィンドウサイズ変更時に全体表示し直すか
    this.drag = null;            // 描画中の状態
    this.pan = null;             // パン中の状態
    this.spaceDown = false;
    this.hover = null;
    this._layers = {};           // { main|under: { arr, ver, canvas } }
    this._rgb = new Map();       // '#rrggbb' -> 0xAABBGGRR

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.render(); });
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    window.addEventListener('resize', () => this.fit());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.matches('textarea, input, select, button')) {
        e.preventDefault();
        if (!this.spaceDown) { this.spaceDown = true; this._cursor(); }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { this.spaceDown = false; this._cursor(); }
    });
  }

  // ---------- 基本操作 ----------
  setSize(size, pixels) {
    this.size = size;
    this.pixels = pixels ? pixels.slice() : new Array(size * size).fill(null);
    if (this.underlay && this.underlay.length !== size * size) this.underlay = null;
    this.undoStack = [];
    this.redoStack = [];
    this.version++;
    this.autoFit = true;
    this.fit();
    this.onChange();
  }

  // 大きいキャンバスは1スナップショットが重いので履歴数を減らす
  get undoLimit() { return this.size <= 64 ? 50 : this.size <= 128 ? 30 : 15; }

  snapshot() {
    this.undoStack.push(this.pixels.slice());
    while (this.undoStack.length > this.undoLimit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.pixels.slice());
    this.pixels = this.undoStack.pop();
    this.version++;
    this.render(); this.onChange();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.pixels.slice());
    this.pixels = this.redoStack.pop();
    this.version++;
    this.render(); this.onChange();
  }

  replaceAll(pixels) {
    this.snapshot();
    this.pixels = pixels.slice();
    this.version++;
    this.render(); this.onChange();
  }
  clear() { this.replaceAll(new Array(this.size * this.size).fill(null)); }

  // 上下左右に1px移動（はみ出しは消える）
  shift(dx, dy) {
    const n = this.size, out = new Array(n * n).fill(null);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) out[ny * n + nx] = this.pixels[y * n + x];
    }
    this.replaceAll(out);
  }
  flipH() {
    const n = this.size, out = new Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = this.pixels[y * n + (n - 1 - x)];
    this.replaceAll(out);
  }

  usedColors() { return [...new Set(this.pixels.filter(Boolean))]; }

  // ---------- 表示（ズーム・パン） ----------
  _fitCell() {
    const W = this.canvas.parentElement.clientWidth, H = this.canvas.parentElement.clientHeight;
    const raw = (Math.min(W, H) - 24) / this.size;
    if (raw >= 1) return Math.max(1, Math.floor(raw));
    return Math.max(ZOOM_LEVELS[0], raw);
  }

  // キャンバス要素をステージに合わせる。autoFit 中は全体表示し直す
  fit() {
    const wrap = this.canvas.parentElement;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.canvas.width = Math.max(1, Math.round(W * dpr));
    this.canvas.height = Math.max(1, Math.round(H * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.autoFit) {
      this.cell = this._fitCell();
      this._center();
    }
    this.render();
    this.onView();
  }

  fitToView() { this.autoFit = true; this.fit(); }

  _center() {
    const W = this.canvas.parentElement.clientWidth, H = this.canvas.parentElement.clientHeight;
    const px = this.cell * this.size;
    this.panX = Math.round((W - px) / 2);
    this.panY = Math.round((H - px) / 2);
  }

  // (cx, cy) を固定点として拡大率を変える
  setZoom(cell, cx, cy) {
    const W = this.canvas.parentElement.clientWidth, H = this.canvas.parentElement.clientHeight;
    if (cx === undefined) { cx = W / 2; cy = H / 2; }
    const min = Math.min(ZOOM_LEVELS[0], this._fitCell());
    cell = Math.max(min, Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], cell));
    const ix = (cx - this.panX) / this.cell, iy = (cy - this.panY) / this.cell;
    this.cell = cell;
    this.panX = Math.round(cx - ix * cell);
    this.panY = Math.round(cy - iy * cell);
    this.autoFit = false;
    this.render();
    this.onView();
  }
  zoomStep(dir, cx, cy) {
    const c = this.cell;
    const next = dir > 0
      ? ZOOM_LEVELS.find((z) => z > c + 1e-6) ?? c
      : [...ZOOM_LEVELS].reverse().find((z) => z < c - 1e-6) ?? c;
    this.setZoom(next, cx, cy);
  }

  _wheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.ctrlKey || !e.shiftKey) {
      this.zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    } else {
      // Shift+ホイールで横スクロール
      this.panX -= e.deltaY;
      this.autoFit = false;
      this.render();
    }
  }

  _cursor() {
    this.canvas.style.cursor = this.pan ? 'grabbing' : this.spaceDown ? 'grab' : 'crosshair';
  }

  // 色文字列 -> ImageData 用の 32bit 値（リトルエンディアン ABGR）
  _rgba(c) {
    let v = this._rgb.get(c);
    if (v === undefined) {
      const n = parseInt(c.slice(1), 16);
      v = (0xff << 24 | (n & 0xff) << 16 | (n & 0xff00) | (n >> 16 & 0xff)) >>> 0;
      this._rgb.set(c, v);
    }
    return v;
  }

  // 配列を n×n のオフスクリーンキャンバスにする（同じ配列・版ならキャッシュを使う）
  _layer(slot, arr) {
    const n = this.size;
    const ver = arr === this.pixels ? this.version : -1;
    const L = this._layers[slot];
    if (L && L.arr === arr && L.ver === ver && ver !== -1 && L.canvas.width === n) return L.canvas;
    const cv = (L && L.canvas.width === n) ? L.canvas : document.createElement('canvas');
    cv.width = cv.height = n;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(n, n);
    const u32 = new Uint32Array(img.data.buffer);
    for (let i = 0; i < arr.length; i++) if (arr[i]) u32[i] = this._rgba(arr[i]);
    cx.putImageData(img, 0, 0);
    this._layers[slot] = { arr, ver, canvas: cv };
    return cv;
  }

  _checker() {
    if (this._checkerPat) return this._checkerPat;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#eceef3'; cx.fillRect(0, 0, 16, 16);
    cx.fillStyle = '#cfd2da'; cx.fillRect(8, 0, 8, 8); cx.fillRect(0, 8, 8, 8);
    this._checkerPat = this.ctx.createPattern(cv, 'repeat');
    return this._checkerPat;
  }

  render() {
    const { ctx, size: n, cell: c, panX: ox, panY: oy } = this;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const S = n * c;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;

    // 影と市松模様（透明部分）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#eceef3';
    ctx.fillRect(ox, oy, S, S);
    ctx.restore();
    ctx.save();
    ctx.translate(ox, oy);
    ctx.fillStyle = this._checker();
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    // 下絵
    if (this.showUnderlay && this.underlay) {
      ctx.globalAlpha = this.underlayOpacity;
      ctx.drawImage(this._layer('under', this.underlay), ox, oy, S, S);
      ctx.globalAlpha = 1;
    }
    // 本体（描画中のプレビュー込み）
    let px = this.pixels;
    if (this.drag && this.drag.preview) px = this.drag.preview;
    ctx.drawImage(this._layer('main', px), ox, oy, S, S);

    // ホバー
    if (this.hover && !this.drag && !this.pan) {
      const pts = this._mirrorPts([this.hover]);
      ctx.strokeStyle = 'rgba(255,80,120,0.9)';
      ctx.lineWidth = c >= 4 ? 2 : 1;
      // 小さく表示しているときは枠をピクセルの外側に出して見えるようにする
      const inset = c >= 4 ? 1 : -1;
      for (const p of pts) ctx.strokeRect(ox + p.x * c + inset, oy + p.y * c + inset, c - 2 * inset, c - 2 * inset);
    }
    // グリッド（見えている範囲だけ）
    if (this.showGrid && c >= 6) {
      const x0 = Math.max(0, Math.floor(-ox / c)), x1 = Math.min(n, Math.ceil((W - ox) / c));
      const y0 = Math.max(0, Math.floor(-oy / c)), y1 = Math.min(n, Math.ceil((H - oy) / c));
      const major = n >= 128 ? 16 : 8;
      const lines = (pred) => {
        ctx.beginPath();
        for (let i = Math.max(1, x0); i <= Math.min(n - 1, x1); i++) if (pred(i)) {
          const X = Math.round(ox + i * c) + 0.5;
          ctx.moveTo(X, oy); ctx.lineTo(X, oy + S);
        }
        for (let i = Math.max(1, y0); i <= Math.min(n - 1, y1); i++) if (pred(i)) {
          const Y = Math.round(oy + i * c) + 0.5;
          ctx.moveTo(ox, Y); ctx.lineTo(ox + S, Y);
        }
        ctx.stroke();
      };
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      lines(() => true);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      lines((i) => i % major === 0);
    }
    if (this.mirrorX) {
      ctx.strokeStyle = 'rgba(80,140,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox + (n / 2) * c, oy); ctx.lineTo(ox + (n / 2) * c, oy + S);
      ctx.stroke();
    }
  }

  // ---------- 書き出し ----------
  // 範囲 (x, y, w, h) を scale 倍で PNG の dataURL にする（省略時は全体）
  toDataURL(scale = 1, x = 0, y = 0, w = this.size, h = this.size) {
    const cv = document.createElement('canvas');
    cv.width = w * scale;
    cv.height = h * scale;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(this._layer('export', this.pixels), x, y, w, h, 0, 0, w * scale, h * scale);
    return cv.toDataURL('image/png');
  }

  // ---------- マウス操作 ----------
  _cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - this.panX) / this.cell);
    const y = Math.floor((e.clientY - r.top - this.panY) / this.cell);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    return { x, y };
  }

  _mirrorPts(pts) {
    if (!this.mirrorX) return pts;
    const out = [];
    for (const p of pts) { out.push(p); out.push({ x: this.size - 1 - p.x, y: p.y }); }
    return out;
  }

  _set(arr, pts, color) {
    for (const p of this._mirrorPts(pts)) {
      if (p.x < 0 || p.y < 0 || p.x >= this.size || p.y >= this.size) continue;
      arr[p.y * this.size + p.x] = color;
    }
    if (arr === this.pixels) this.version++;
  }

  _down(e) {
    // 中ボタン or スペース+ドラッグでパン
    if (e.button === 1 || this.spaceDown) {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.pan = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
      this._cursor();
      return;
    }
    const p = this._cellAt(e);
    if (!p) return;
    this.canvas.setPointerCapture(e.pointerId);
    const erase = e.button === 2 || this.tool === 'eraser';
    const color = erase ? null : this.color;
    const tool = e.button === 2 && this.tool !== 'line' && this.tool !== 'rect' && this.tool !== 'fill' ? 'pen' : this.tool;

    if (this.tool === 'picker' || e.altKey) {
      const c = this.pixels[p.y * this.size + p.x];
      if (c) this.onPick(c);
      return;
    }
    if (tool === 'fill') {
      this.snapshot();
      this._fill(p, color);
      if (this.mirrorX) this._fill({ x: this.size - 1 - p.x, y: p.y }, color);
      if (color) this.onColorUsed(color);
      this.render(); this.onChange();
      return;
    }
    this.snapshot();
    this.drag = { tool, start: p, last: p, color };
    if (tool === 'pen' || tool === 'eraser') {
      this._set(this.pixels, [p], color);
    } else {
      this.drag.preview = this.pixels.slice();
      this._shapePreview(p);
    }
    this.render();
  }

  _move(e) {
    if (this.pan) {
      this.panX = this.pan.px + (e.clientX - this.pan.x);
      this.panY = this.pan.py + (e.clientY - this.pan.y);
      this.autoFit = false;
      this.render();
      return;
    }
    const p = this._cellAt(e);
    const same = p && this.hover && p.x === this.hover.x && p.y === this.hover.y;
    this.hover = p;
    if (!this.drag) { if (!same) this.render(); return; }
    if (!p || same) return;
    const d = this.drag;
    if (d.tool === 'pen' || d.tool === 'eraser') {
      this._set(this.pixels, this._linePts(d.last, p), d.color);
      d.last = p;
    } else {
      this._shapePreview(p);
    }
    this.render();
  }

  _up() {
    if (this.pan) { this.pan = null; this._cursor(); this.onView(); return; }
    const d = this.drag;
    if (!d) return;
    if (d.preview) { this.pixels = d.preview; this.version++; }
    this.drag = null;
    if (d.color) this.onColorUsed(d.color);
    this.render(); this.onChange();
  }

  _shapePreview(p) {
    const d = this.drag;
    d.preview = this.pixels.slice();
    const pts = d.tool === 'line' ? this._linePts(d.start, p) : this._rectPts(d.start, p);
    this._set(d.preview, pts, d.color);
  }

  _linePts(a, b) {
    const pts = [];
    let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pts.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  }

  _rectPts(a, b) {
    const pts = [];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (let x = x0; x <= x1; x++) { pts.push({ x, y: y0 }, { x, y: y1 }); }
    for (let y = y0; y <= y1; y++) { pts.push({ x: x0, y }, { x: x1, y }); }
    return pts;
  }

  _fill(p, color) {
    const n = this.size, px = this.pixels;
    const target = px[p.y * n + p.x];
    if (target === color) return;
    const stack = [p.y * n + p.x];
    while (stack.length) {
      const i = stack.pop();
      if (px[i] !== target) continue;
      px[i] = color;
      const x = i % n, y = (i / n) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < n - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - n);
      if (y < n - 1) stack.push(i + n);
    }
    this.version++;
  }
}

window.PixelEditor = PixelEditor;
window.PIXEL_SIZES = SIZES;
