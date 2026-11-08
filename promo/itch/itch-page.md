# itch.io ページ設定（コピペ用）

itch.io → Dashboard → **Create new project** で、下の内容を各欄に入れてください。

## 基本設定

| 欄 | 入力内容 |
|---|---|
| Title | `Pixel AI Editor` |
| Project URL | `https://motchan2000.itch.io/pixel-ai-editor`（itch.io のユーザー名に合わせて自動で決まります） |
| Short description or tagline | `AI sketches the rough, you make it yours. A 16/32/64px pixel art editor with MCP support.` |
| Classification | **Tools** |
| Kind of project | **Downloadable** |
| Release status | **Released** |
| Pricing | **No payments**（無料）または **$0 or donate**（投げ銭を受けたい場合） |
| Uploads | `Pixel-AI-Editor-Setup-1.1.0.exe` をアップロードし、**Windows** にチェック |
| Cover image | `promo/itch/cover.png`（630×500） |
| Screenshots | `docs/screenshot.png`（あれば、AI がラフを描く→手直しする流れの GIF も追加すると効果的） |
| Genre | （Tools の場合は空欄で OK） |
| Tags | `pixel-art`, `sprite-editor`, `ai`, `mcp`, `tool`, `2d`, `game-assets`, `sprites`, `editor`, `japanese` |
| AI generation disclosure | **Yes**（このツール自体が生成 AI を使う機能を持つため。itch.io の方針では、生成 AI を使うプロジェクトはこの欄で開示します） |
| App store links / Community | GitHub: `https://github.com/motchan2000/pixel-ai-editor` |
| Visibility | まず **Draft** で保存 → 表示を確認してから **Public** |

## Description（本文）

itch.io の本文欄はリッチテキストです。下を貼り付け、見出しは「Heading」に、箇条書きはリストに整えてください。

---

**AI sketches the rough. You make it yours.**

Pixel AI Editor is a free pixel art editor for **16×16, 32×32 and 64×64** sprites. Describe what you want, let AI draw a first draft, then refine every pixel by hand — or trace over it in your own style.

### Features

- **AI rough drafts** — type "a small knight holding a blue sword" and get a sprite at your chosen size and color count, right on the canvas.
- **Bring your own AI** — DeepSeek, OpenAI, Claude, Gemini, OpenRouter, or run fully offline with **Ollama / LM Studio** (no API key needed). Any OpenAI-compatible API works.
- **Full editing toolkit** — pen, eraser, fill, eyedropper, line, rectangle, mirror drawing, shift, flip, undo/redo.
- **Tracing mode** — show the AI draft as a semi-transparent underlay and redraw it with your own linework.
- **MCP server built in** — Claude, Cursor, VS Code and other MCP clients can draw, inspect and export sprites, live in the running app. No Node.js required.
- **Export** — PNG at 1×, 8× or 16×, plus a project file to continue later.

### How to use

1. Install and launch the app.
2. Open the **AI設定** (AI settings) panel at the bottom right, choose a service and enter your API key. (Local LLMs need no key.)
3. Pick a size, type a prompt and press **ラフを生成** (Generate).
4. Refine the draft, then press **PNG書き出し** (Export PNG).

### Notes

- **Windows 10/11 (64-bit).**
- **The UI is currently in Japanese.** A label guide is on [GitHub](https://github.com/motchan2000/pixel-ai-editor/blob/main/README.en.md).
- The installer is not code-signed. If Windows SmartScreen warns you, click "More info" → "Run anyway".
- AI generation uses your own API key and is billed by the AI service you choose. Keys are stored only on your PC.
- Open source (MIT): [github.com/motchan2000/pixel-ai-editor](https://github.com/motchan2000/pixel-ai-editor)

---

### 日本語

AI がラフを描き、あなたが仕上げる。16×16・32×32・64×64 のドット絵エディタです。DeepSeek・OpenAI・Claude・Gemini・ローカル LLM など好きな AI でラフを生成し、そのまま手直しできます。MCP 対応で、Claude などの AI エージェントから直接描かせることもできます。無料・オープンソース（MIT）。

---

## 公開後にやること

- itch.io のページ URL を紹介ページ・README に追加（言ってもらえれば私が追記します）
- 新バージョンを出したら、itch.io の Uploads にも新しい exe を追加（古いものは削除か非表示に）
