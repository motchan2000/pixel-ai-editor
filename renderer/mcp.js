// MCP 経由の命令をエディタに反映する（main.js が executeJavaScript で呼ぶ）
(() => {
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=?@^~!<>';
  // 1文字=1色。足りなくなったら CJK 統合漢字を順に使う（大きいキャンバスでは色数が多くなるため）
  const charFor = (i) => (i < CHARS.length ? CHARS[i] : String.fromCodePoint(0x4e00 + i - CHARS.length));
  const badge = () => document.querySelector('#mcp-badge');

  function flash(text) {
    const b = badge();
    if (!b) return;
    b.textContent = text;
    b.classList.add('active');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { b.classList.remove('active'); refreshBadge(); }, 1500);
  }

  async function refreshBadge() {
    const b = badge();
    if (!b || b.classList.contains('active')) return;
    const s = await window.api.mcpStatus();
    b.textContent = s.listening ? 'MCP 待機中' : 'MCP 停止';
    b.title = s.listening ? `127.0.0.1:${s.port} で待ち受け中` : '';
  }

  function color(c) {
    if (c === null || c === undefined || c === '' || c === 'transparent') return null;
    let s = String(c).trim().toLowerCase();
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (!/^#[0-9a-f]{6}$/.test(s)) throw new Error(`色の形式が不正です: ${c}（#rrggbb で指定）`);
    return s;
  }

  function int(v, name) {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`${name} は整数で指定してください`);
    return n;
  }

  function inBounds(x, y) { return x >= 0 && y >= 0 && x < editor.size && y < editor.size; }

  // 変更を1回のUndo単位として反映
  function commit(arr, label) {
    editor.replaceAll(arr);
    flash(`MCP: ${label}`);
  }

  // 範囲 (x0, y0, w, h) を文字グリッドにする
  function canvasText(x0, y0, w, h) {
    const n = editor.size;
    const map = new Map();
    const palette = {};
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const c = editor.pixels[y * n + x];
      if (c && !map.has(c)) {
        const ch = charFor(map.size);
        map.set(c, ch);
        palette[ch] = c;
      }
    }
    const rows = [];
    for (let y = y0; y < y0 + h; y++) {
      let r = '';
      for (let x = x0; x < x0 + w; x++) {
        const c = editor.pixels[y * n + x];
        r += c ? map.get(c) : '.';
      }
      rows.push(r);
    }
    return { palette, rows };
  }

  function linePts(x0, y0, x1, y1) { return editor._linePts({ x: x0, y: y0 }, { x: x1, y: y1 }); }

  const handlers = {
    get_info() {
      return { size: editor.size, current_color: editor.color, used_colors: editor.usedColors() };
    },

    // x, y, w, h で範囲を指定できる。64px を超えるキャンバス全体は文字グリッドが巨大になるので既定で画像のみ
    get_canvas({ include_image = true, include_rows, x, y, w, h }) {
      const n = editor.size;
      const region = x !== undefined || y !== undefined || w !== undefined || h !== undefined;
      const x0 = Math.max(0, Math.min(n - 1, int(x ?? 0, 'x'))), y0 = Math.max(0, Math.min(n - 1, int(y ?? 0, 'y')));
      const rw = Math.max(1, Math.min(n - x0, int(w ?? n - x0, 'w'))), rh = Math.max(1, Math.min(n - y0, int(h ?? n - y0, 'h')));
      const out = { size: n };
      if (region) out.region = { x: x0, y: y0, w: rw, h: rh };
      if (include_rows ?? (region || n <= 64)) {
        Object.assign(out, canvasText(x0, y0, rw, rh), { legend: '"." は透明' });
      } else {
        out.note = '64px を超えるため rows は省略しました。x, y, w, h で範囲を指定するか include_rows=true で取得できます。';
      }
      if (include_image) out.image = editor.toDataURL(Math.max(1, Math.floor(512 / Math.max(rw, rh))), x0, y0, rw, rh);
      return out;
    },

    new_canvas({ size }) {
      size = int(size, 'size');
      if (!window.PIXEL_SIZES.includes(size)) throw new Error(`size は ${window.PIXEL_SIZES.join(' / ')} のいずれかです`);
      window.appResetForSize(size);
      flash(`MCP: ${size}×${size} 新規`);
      return { size };
    },

    draw_rows({ rows, palette = {}, x = 0, y = 0 }) {
      if (!Array.isArray(rows) || !rows.length) throw new Error('rows は文字列の配列で指定してください');
      const pal = {};
      for (const [k, v] of Object.entries(palette)) {
        if ([...k].length !== 1) throw new Error(`パレットのキーは1文字です: "${k}"`);
        if (k === '.' || k === '_') continue;
        pal[k] = color(v);
      }
      x = int(x, 'x'); y = int(y, 'y');
      const n = editor.size, arr = editor.pixels.slice();
      const unknown = new Set();
      let count = 0;
      rows.forEach((row, dy) => {
        [...String(row)].forEach((ch, dx) => {
          const px = x + dx, py = y + dy;
          if (!inBounds(px, py) || ch === '_' || ch === ' ') return;
          if (ch === '.') { arr[py * n + px] = null; count++; return; }
          if (!(ch in pal)) { unknown.add(ch); return; }
          arr[py * n + px] = pal[ch];
          count++;
        });
      });
      commit(arr, `${count}px 描画`);
      return { changed: count, unknown_chars: [...unknown] };
    },

    set_pixels({ pixels }) {
      if (!Array.isArray(pixels)) throw new Error('pixels は配列で指定してください');
      const n = editor.size, arr = editor.pixels.slice();
      let count = 0;
      for (const p of pixels) {
        const px = int(p.x, 'x'), py = int(p.y, 'y');
        if (!inBounds(px, py)) continue;
        arr[py * n + px] = color(p.color);
        count++;
      }
      commit(arr, `${count}px 描画`);
      return { changed: count };
    },

    fill({ x, y, color: c }) {
      x = int(x, 'x'); y = int(y, 'y');
      if (!inBounds(x, y)) throw new Error('座標がキャンバスの外です');
      const saved = editor.pixels;
      editor.pixels = saved.slice();
      editor._fill({ x, y }, color(c));
      const after = editor.pixels;
      editor.pixels = saved;
      commit(after, '塗りつぶし');
      return { ok: true };
    },

    line({ x1, y1, x2, y2, color: c }) {
      const n = editor.size, arr = editor.pixels.slice(), col = color(c);
      for (const p of linePts(int(x1, 'x1'), int(y1, 'y1'), int(x2, 'x2'), int(y2, 'y2'))) {
        if (inBounds(p.x, p.y)) arr[p.y * n + p.x] = col;
      }
      commit(arr, '直線');
      return { ok: true };
    },

    rect({ x1, y1, x2, y2, color: c, filled = false }) {
      x1 = int(x1, 'x1'); y1 = int(y1, 'y1'); x2 = int(x2, 'x2'); y2 = int(y2, 'y2');
      const n = editor.size, arr = editor.pixels.slice(), col = color(c);
      const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
      for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
        const edge = xx === xa || xx === xb || yy === ya || yy === yb;
        if ((filled || edge) && inBounds(xx, yy)) arr[yy * n + xx] = col;
      }
      commit(arr, filled ? '塗り四角' : '四角');
      return { ok: true };
    },

    clear() {
      commit(new Array(editor.size * editor.size).fill(null), '全消去');
      return { ok: true };
    },

    undo() { editor.undo(); flash('MCP: 元に戻す'); return { ok: true }; },
    redo() { editor.redo(); flash('MCP: やり直し'); return { ok: true }; },

    png({ scale = 1 }) {
      // 書き出し画像は一辺 8192px まで
      scale = Math.max(1, Math.min(32, Math.floor(8192 / editor.size), int(scale, 'scale')));
      return editor.toDataURL(scale);
    },

    apply_rough({ prompt, size, pixels, palette }) {
      if (size !== editor.size) window.appResetForSize(size);
      window.appApplyRough(pixels, palette, `MCP: 「${prompt}」のラフを適用しました`);
      flash('MCP: ラフ生成');
      return { size, colors: palette.length };
    },

    status({ text, busy, error }) {
      window.appSetGenStatus(text, error ? 'error' : busy ? 'busy' : 'ok');
      return { ok: true };
    },
  };

  window.mcpHandle = async (tool, args) => {
    const h = handlers[tool];
    // executeJavaScript は例外メッセージを失うことがあるので、値として返す
    if (!h) return { __error: `未知のツール: ${tool}` };
    try {
      return await h(args || {});
    } catch (e) {
      return { __error: e.message || String(e) };
    }
  };

  refreshBadge();
})();
