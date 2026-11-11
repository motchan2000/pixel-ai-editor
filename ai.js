// AI でラフを生成する処理（プロバイダー非依存）
// - OpenAI 互換の /chat/completions（DeepSeek, OpenAI, Gemini, OpenRouter, Ollama, LM Studio など）
// - Anthropic（Claude）は公式 SDK
const Anthropic = require('@anthropic-ai/sdk');

// プリセット。baseUrl / model は画面で自由に変更できる
const PRESETS = {
  deepseek:   { label: 'DeepSeek',            protocol: 'openai',    baseUrl: 'https://api.deepseek.com',                                  model: 'deepseek-chat',        env: 'DEEPSEEK_API_KEY' },
  openai:     { label: 'OpenAI',              protocol: 'openai',    baseUrl: 'https://api.openai.com/v1',                                 model: 'gpt-5-mini',           env: 'OPENAI_API_KEY' },
  anthropic:  { label: 'Anthropic (Claude)',  protocol: 'anthropic', baseUrl: '',                                                          model: 'claude-opus-5-5',      env: 'ANTHROPIC_API_KEY' },
  gemini:     { label: 'Google Gemini',       protocol: 'openai',    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',   model: 'gemini-2.5-flash',     env: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter',          protocol: 'openai',    baseUrl: 'https://openrouter.ai/api/v1',                              model: 'deepseek/deepseek-chat', env: 'OPENROUTER_API_KEY' },
  ollama:     { label: 'Ollama（ローカル）',    protocol: 'openai',    baseUrl: 'http://localhost:11434/v1',                                 model: 'llama3.1',             env: '', noKey: true },
  lmstudio:   { label: 'LM Studio（ローカル）', protocol: 'openai',    baseUrl: 'http://localhost:1234/v1',                                  model: '',                     env: '', noKey: true },
  custom:     { label: 'その他（OpenAI互換）',   protocol: 'openai',    baseUrl: '',                                                          model: '',                     env: '' },
};

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
- JSON以外の文章は出力しない（コードブロックも不要）。`;
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
function parseRough(text, size) {
  let raw = String(text || '').trim();
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

function fatal(msg) {
  const e = new Error(msg);
  e.fatal = true; // 再試行しない
  return e;
}

// ---------- OpenAI 互換 ----------
function chatUrl(baseUrl) {
  let u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) throw fatal('ベースURLが設定されていません（AI設定で入力してください）');
  if (!/\/chat\/completions$/.test(u)) u += '/chat/completions';
  return u;
}

async function callOpenAI(cfg, prompt, size, maxColors) {
  const url = chatUrl(cfg.baseUrl);
  if (!cfg.model) throw fatal('モデル名が設定されていません（AI設定で入力してください）');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const messages = [
    { role: 'system', content: systemPrompt(size, maxColors) },
    { role: 'user', content: `お題: ${prompt}\nサイズ: ${size}x${size}` },
  ];
  // プロバイダーごとの対応差を吸収するため、400 のときは形を変えて試す
  const variants = [
    { response_format: { type: 'json_object' }, max_tokens: 8000 },
    { max_tokens: 8000 },
    { response_format: { type: 'json_object' }, max_completion_tokens: 16000 },
    { max_completion_tokens: 16000 },
  ];
  let lastErr = '';
  for (const v of variants) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, messages, ...v }) });
    } catch (e) {
      throw fatal(`接続できませんでした: ${url}\n${e.cause?.code || e.message}`);
    }
    if (res.status === 400 || res.status === 422) {
      lastErr = (await res.text().catch(() => '')).slice(0, 300);
      continue;
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      const msg = res.status === 401 || res.status === 403 ? 'APIキーが無効か、権限がありません' :
        res.status === 402 ? '残高が不足しています' :
        res.status === 404 ? 'URLまたはモデル名が見つかりません' :
        res.status === 429 ? 'リクエストが多すぎるか、利用上限に達しました' :
        `APIエラー (${res.status})`;
      throw fatal(`${msg}\n${body}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('応答が空でした');
    return content;
  }
  throw fatal(`APIがリクエストを受け付けませんでした (400)\n${lastErr}`);
}

// ---------- Anthropic (Claude) ----------
async function callAnthropic(cfg, prompt, size, maxColors) {
  if (!cfg.apiKey) throw fatal('APIキーが設定されていません（AI設定で入力してください）');
  const client = new Anthropic({ apiKey: cfg.apiKey });
  try {
    // 出力が長くなる 64x64 でもタイムアウトしないようストリーミングで受け取る
    const stream = client.beta.messages.stream({
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 32000,
      system: systemPrompt(size, maxColors),
      messages: [{ role: 'user', content: `お題: ${prompt}\nサイズ: ${size}x${size}` }],
      // 安全分類器に断られた場合はサーバー側で別モデルに切り替える
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw fatal('モデルがこのお題の生成を断りました。お題を変えてみてください');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new Error('応答が空でした');
    return text;
  } catch (e) {
    if (e.fatal) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw fatal('APIキーが無効です');
    if (e instanceof Anthropic.PermissionDeniedError) throw fatal('このAPIキーではこのモデルを使えません');
    if (e instanceof Anthropic.NotFoundError) throw fatal(`モデルが見つかりません: ${cfg.model}`);
    if (e instanceof Anthropic.RateLimitError) throw fatal('リクエストが多すぎます。少し待ってください');
    if (e instanceof Anthropic.BadRequestError) throw fatal(`リクエストエラー: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw fatal('Anthropic API に接続できませんでした');
    if (e instanceof Anthropic.APIError) throw fatal(`APIエラー (${e.status}): ${e.message}`);
    throw e;
  }
}

async function callOnce(cfg, prompt, size, maxColors) {
  const text = cfg.protocol === 'anthropic'
    ? await callAnthropic(cfg, prompt, size, maxColors)
    : await callOpenAI(cfg, prompt, size, maxColors);
  return parseRough(text, size);
}

// cfg: { protocol, baseUrl, model, apiKey, noKey }
async function generateRough({ cfg, prompt, size, maxColors = 12 }) {
  if (!cfg) throw new Error('AI設定がありません');
  // キーが無くても OpenAI 互換はそのまま試す（ローカルサーバーはキー不要のため）。401 なら案内を出す
  if (![16, 32, 64, 128, 256, 512].includes(size)) throw new Error('サイズは16/32/64/128/256/512のいずれかです');
  // AI が1文字ずつ出力できるのは 64px 程度まで。大きいキャンバスは 64px で生成して整数倍に拡大する
  const genSize = Math.min(size, 64);
  let r;
  try {
    r = await callOnce(cfg, prompt, genSize, maxColors);
  } catch (e) {
    if (e.fatal) throw e;
    // JSON の崩れなどは1回だけ再試行
    r = await callOnce(cfg, prompt, genSize, maxColors);
  }
  return genSize === size ? r : upscale(r, size);
}

// ニアレストネイバーで size×size に拡大（size は r.size の整数倍）
function upscale(r, size) {
  const k = size / r.size;
  const pixels = new Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.floor(y / k) * r.size;
    for (let x = 0; x < size; x++) pixels[y * size + x] = r.pixels[sy + Math.floor(x / k)];
  }
  return { size, pixels, palette: r.palette };
}

module.exports = { PRESETS, generateRough, parseRough, normalizeColor, upscale };
