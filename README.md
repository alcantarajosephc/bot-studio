# Bot Studio

A team of bots for short-form video. Add videos and they get a cover image, an SEO caption and a posting time. There's also a video editor that cuts and styles talking-head videos, and a Review tool for leaving timestamped notes that turn into the next version.

Posting to platforms isn't connected yet.

## Run it

Needs Node 20+ and ffmpeg (`winget install Gyan.FFmpeg`).

```powershell
npm install
npm run dev
```

Open http://localhost:5173.

**No keys needed.** Bot Studio defaults to the Claude Code CLI for writing (captions and edit plans) and local Whisper for transcription, so a fresh install produces its first caption and v1 edit with no API keys. You need:

- The **Claude Code CLI** installed, with `claude` run once so you're signed in. Usage counts against your Claude subscription. The **Keys & models** page shows a live "Claude Code: signed in / not found" check.
- **Local Whisper** for transcription: `pip install openai-whisper`.

Trade-offs of the keyless mode: each request starts a CLI process (a few seconds slower), usage counts against your Claude subscription's usage and rate limits, and there's no server-side model fallback on refusals. This is for personal use on your own machine; sharing the app with others would mean each person needs their own Claude login or the API (check Anthropic's terms first).

If the CLI isn't on your PATH, set the `CLAUDE_CODE_PATH` environment variable to its location (the only place the app reads the executable path from — it's never web-settable).

**Prefer per-token API billing or faster transcription?** On **Keys & models**, switch the Writing model to **Claude** (Anthropic API) and/or Listening to **Groq Whisper**, and paste the matching key:

- **Anthropic API key** (captions and edit plans): console.anthropic.com. Billed per use, separately from a Claude.ai subscription.
- **Groq API key** (transcription, and optionally writing): console.groq.com

`npm start` builds once and serves everything at http://localhost:4747.

Add videos on the **Drop videos** node, or copy them into `data/inbox/`. Then press **Run everything**, or turn on **Running**.

### Quick demo with no CLI at all

`npx tsx tests/demo-server.ts` runs the app with a stand-in writing model and local Whisper (`pip install openai-whisper`), so you can click around without even the Claude Code CLI. Its data goes to `data-demo/`.

## How it works

```
Drop videos -> Thumbnail Bot -> SEO Caption Bot -> Scheduler Bot -> Bot Manager -> Posting Bot (not connected)
Video Editor -> Review Bot
```

Each bot is its own worker with its own queue, status and log, so different bots work at the same time: one video can get its cover while another is being captioned. The **Bot Manager** routes each video to the next step.

| Bot | What it does | AI? |
|---|---|---|
| Thumbnail | Samples up to 40 frames, scores sharpness and exposure, keeps the best | No (ffmpeg) |
| SEO Caption | Transcribes (Groq Whisper), then Claude writes the caption from your rules and style examples | Yes |
| Scheduler | Day presets, auto spread (under 10 videos share one day, 10+ spread out, up to 100 a day) or fixed times (up to 20 a day), per-video times, reorder, time zone | No |
| Posting | Reports what's waiting. No platform connected | No |
| Video Editor | Transcribes and finds pauses, Claude plans the edit by word index, code compiles exact cuts, Remotion renders 1080x1920 | Yes |
| Review | Timestamped notes are mapped back to source words, Claude revises the plan, the editor renders the next version | Yes |

## Customizing

| Change | Where |
|---|---|
| App name | `shared/brand.ts` |
| Add a bot | Add an entry to `config/bots.json`, write a job in `server/bots/`, route to it in `server/bots/manager.ts`. It appears in the canvas, office, log and status rows. |
| Bot names, colors, personalities, office lines | `config/bots.json` |
| Bot look | `shared/sprites.ts` (pixel grids and palettes) |
| Switch caption/edit model (e.g. Groq) | Keys & models page, or add a provider in `server/providers/llm/` |
| Switch speech-to-text | `server/providers/transcribe.ts` (Groq and local Whisper included) |
| Caption instructions | `prompts/caption.md` |
| Editing instructions | `prompts/edit-plan.md`, `prompts/edit-revise.md` |
| Video look (fonts, colors, caption size and position) | `editor-remotion/theme.ts`, `editor-remotion/EditVideo.tsx` |
| Cut rules (padding, caption length) | constants at the top of `server/bots/editor/compile.ts` |
| Scheduling rules | `server/bots/scheduler.ts` |
| Posting to TikTok / Facebook / Instagram / YouTube | implement `PostingAdapter` in `server/bots/posting.ts` |
| Office layout | `DESKS` / `LOUNGE` in `app/src/views/Office.tsx` |
| Live events for new UI | subscribe to the `EventBus` in `server/core/events.ts` |

## Your data

Everything stays in `data/`: videos, covers, captions, schedules, edits, style examples and `settings.json` (which holds your keys). It's gitignored.

## Tests

All tests use fake AI providers, so they run free and need no keys.

| Command | What runs |
|---|---|
| `npm test` | Vitest, 64 tests: thumbnail scoring, caption prompts, scheduler rules, format helpers, the timeline compiler, the Claude Code CLI provider (with a fake `claude` command), the settings allowlist, the full pipeline over HTTP, and a real Remotion render of a first version and a revised one |
| `npm run test:e2e` | Playwright, 30 tests in a real Chromium: every page and panel, uploading and dropping videos, Run everything and Running, caption rules and style training, scheduler changes, the keyless Claude Code default and switching to API keys, the office canvas, the editor → Review → revise loop, and keys never reaching the browser |
| `npm run test:all` | Typecheck, then both of the above |

The first time, install the test browser with `npx playwright install chromium`. The UI tests build the app and start their own server on port 4848 with a fresh data folder each run (`tests/e2e-server.ts`). After a failure, `npx playwright show-trace` opens the saved trace from `test-results/`.
