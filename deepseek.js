// DeepSeek API 呼び出しと、応答(JSON)をドット絵データに変換する処理
const API_URL = 'https://api.deepseek.com/chat/completions';

function systemPrompt(size, maxColors) {
  return `あなたはプロのドット絵(ピクセルアート)作家です。
ユーザーの説明から ${size}x${size} ピクセルのドット絵を作り、次の形式のJSONだけを出力してください。

{
  "palette": { ".": "transparent", "a": "#1a1c2c", "b": "#ff004d" },
  "rows": [ "${'.'.repeat(size)}", ... ]
}

厳守するルール:
- "rows" はちょうど ${size} 個の文字列。各文字列はちょうど ${size} 文字。
- 1文字 = 1ピクセル。"." は透明(背景)。
- それ以外の文字は palette のキー(半角英数字1文字)で、値は "#rrggbb" 形式の色。
- 色数は透明を除いて最大 ${maxColors} 色。
- モチーフをキャンバス中央に大きく配置し、上下左右に1〜2ピクセルの余白を残す。
- 暗い色の輪郭線、明るいハイライト、暗い影を使い、立体感のあるドット絵らしい表現にする。
- 背景は透明(".")のままにする。
- JSON以外の文章は出力しない。`;
}

// "#abc" / "abc" / "#AABBCC" などを "#aabbcc" に正規化。無効なら null
function normalizeColor(c) {
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (s === 'transparent' || s === 'none' || s === '') return null;
  if (s[0] !== '#') s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7); // アルファは無視
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

// モデル出力テキスト -> { size, pixels: (string|null)[], palette: string[] }
// pixels は行優先で size*size 要素。null は透明。
function parseRough(text, size) {
  let raw = String(text || '').trim();
  // ```json ... ``` で囲まれていた場合に対応
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('応答にJSONが見つかりません');
  const data = JSON.parse(raw.slice(start, end + 1));

  const palIn = data.palette && typeof data.palette === 'object' ? data.palette : {};
  const pal = {};
  for (const [k, v] of Object.entries(palIn)) {
    if (k.length !== 1) continue;
    pal[k] = normalizeColor(v);
  }

  let rows = Array.isArray(data.rows) ? data.rows : [];
  rows = rows.map((r) => (typeof r === 'string' ? r : Array.isArray(r) ? r.join('') : ''));
  if (rows.length === 0) throw new Error('rows が空です');

  const pixels = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < size; x++) {
      const ch = row[x];
      if (ch === undefined || ch === '.' || ch === ' ') continue;
      pixels[y * size + x] = pal[ch] || null;
    }
  }
  const used = [...new Set(pixels.filter(Boolean))];
  if (used.length === 0) throw new Error('有効なピクセルがありません');
  return { size, pixels, palette: used };
}

async function callOnce(apiKey, prompt, size, maxColors, model) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt(size, maxColors) },
        { role: 'user', content: `お題: ${prompt}\nサイズ: ${size}x${size}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 8000,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = res.status === 401 ? 'APIキーが無効です' :
      res.status === 402 ? 'DeepSeekの残高が不足しています' :
      res.status === 429 ? 'リクエストが多すぎます。少し待ってください' :
      `DeepSeek APIエラー (${res.status})`;
    const err = new Error(`${msg}\n${body.slice(0, 300)}`);
    err.fatal = true; // 再試行しない
    throw err;
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('応答が空でした');
  return parseRough(content, size);
}

async function generateRough({ apiKey, prompt, size, maxColors = 12, model = 'deepseek-chat' }) {
  if (!apiKey) throw new Error('APIキーが設定されていません（右下の「APIキー設定」から入力してください）');
  if (![16, 32, 64].includes(size)) throw new Error('サイズは16/32/64のいずれかです');
  try {
    return await callOnce(apiKey, prompt, size, maxColors, model);
  } catch (e) {
    if (e.fatal) throw e;
    // パース失敗などは1回だけ再試行
    return await callOnce(apiKey, prompt, size, maxColors, model);
  }
}

module.exports = { generateRough, parseRough, normalizeColor };
