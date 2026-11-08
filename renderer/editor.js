// ドット絵エディタ本体（キャンバス描画・ツール・Undo）
class PixelEditor {
  constructor(canvas, { onChange, onPick, onColorUsed } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onChange = onChange || (() => {});
    this.onPick = onPick || (() => {});
    this.onColorUsed = onColorUsed || (() => {});
    this.size = 16;
    this.pixels = new Array(16 * 16).fill(null); // '#rrggbb' or null
    this.underlay = null;        // AIラフ（下絵）
    this.underlayOpacity = 0.4;
    this.showUnderlay = false;
    this.tool = 'pen';
    this.color = '#000000';
    this.showGrid = true;
    this.mirrorX = false;
    this.undoStack = [];
    this.redoStack = [];
    this.cell = 20;
    this.drag = null;            // 描画中の状態
    this.hover = null;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.render(); });
    window.addEventListener('resize', () => this.fit());
  }

  // ---------- 基本操作 ----------
  setSize(size, pixels) {
    this.size = size;
    this.pixels = pixels ? pixels.slice() : new Array(size * size).fill(null);
    if (this.underlay && this.underlay.length !== size * size) this.underlay = null;
    this.undoStack = [];
    this.redoStack = [];
    this.fit();
    this.onChange();
  }

  snapshot() {
    this.undoStack.push(this.pixels.slice());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.pixels.slice());
    this.pixels = this.undoStack.pop();
    this.render(); this.onChange();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.pixels.slice());
    this.pixels = this.redoStack.pop();
    this.render(); this.onChange();
  }

  replaceAll(pixels) {
    this.snapshot();
    this.pixels = pixels.slice();
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

  // ---------- 表示 ----------
  fit() {
    const wrap = this.canvas.parentElement;
    const avail = Math.min(wrap.clientWidth, wrap.clientHeight) - 24;
    this.cell = Math.max(4, Math.floor(avail / this.size));
    const px = this.cell * this.size;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = px + 'px';
    this.canvas.style.height = px + 'px';
    this.canvas.width = px * dpr;
    this.canvas.height = px * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  render() {
    const { ctx, size: n, cell: c } = this;
    ctx.imageSmoothingEnabled = false;
    // 市松模様（透明部分）
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#cfd2da' : '#eceef3';
      ctx.fillRect(x * c, y * c, c, c);
    }
    // 下絵
    if (this.showUnderlay && this.underlay) {
      ctx.globalAlpha = this.underlayOpacity;
      this._drawPixels(this.underlay);
      ctx.globalAlpha = 1;
    }
    // 本体（描画中のプレビュー込み）
    let px = this.pixels;
    if (this.drag && this.drag.preview) px = this.drag.preview;
    this._drawPixels(px);

    // ホバー
    if (this.hover && !this.drag) {
      const pts = this._mirrorPts([this.hover]);
      ctx.strokeStyle = 'rgba(255,80,120,0.9)';
      ctx.lineWidth = 2;
      for (const p of pts) ctx.strokeRect(p.x * c + 1, p.y * c + 1, c - 2, c - 2);
    }
    // グリッド
    if (this.showGrid && c >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(i * c + 0.5, 0); ctx.lineTo(i * c + 0.5, n * c);
        ctx.moveTo(0, i * c + 0.5); ctx.lineTo(n * c, i * c + 0.5);
      }
      ctx.stroke();
      // 8pxごとの太線
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      for (let i = 8; i < n; i += 8) {
        ctx.moveTo(i * c + 0.5, 0); ctx.lineTo(i * c + 0.5, n * c);
        ctx.moveTo(0, i * c + 0.5); ctx.lineTo(n * c, i * c + 0.5);
      }
      ctx.stroke();
    }
    if (this.mirrorX) {
      ctx.strokeStyle = 'rgba(80,140,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((n / 2) * c, 0); ctx.lineTo((n / 2) * c, n * c);
      ctx.stroke();
    }
  }

  _drawPixels(px) {
    const { ctx, size: n, cell: c } = this;
    for (let i = 0; i < px.length; i++) {
      if (!px[i]) continue;
      ctx.fillStyle = px[i];
      ctx.fillRect((i % n) * c, Math.floor(i / n) * c, c, c);
    }
  }

  // ---------- 書き出し ----------
  toDataURL(scale = 1) {
    const n = this.size;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n * scale;
    const cx = cv.getContext('2d');
    for (let i = 0; i < this.pixels.length; i++) {
      if (!this.pixels[i]) continue;
      cx.fillStyle = this.pixels[i];
      cx.fillRect((i % n) * scale, Math.floor(i / n) * scale, scale, scale);
    }
    return cv.toDataURL('image/png');
  }

  // ---------- マウス操作 ----------
  _cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / this.cell);
    const y = Math.floor((e.clientY - r.top) / this.cell);
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
  }

  _down(e) {
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
    const p = this._cellAt(e);
    this.hover = p;
    if (!this.drag) { this.render(); return; }
    if (!p) return;
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
    const d = this.drag;
    if (!d) return;
    if (d.preview) this.pixels = d.preview;
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
  }
}

window.PixelEditor = PixelEditor;
