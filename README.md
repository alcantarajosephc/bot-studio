# Bot Studio

A team of bots for short-form video. Add videos and they get a cover image, an SEO caption and a posting time. There's also a video editor that cuts and styles talking-head videos, and a Review tool for leaving timestamped notes that turn into the next version.

Posting to platforms isn't connected yet.

## Run it

Needs Node 20+ and ffmpeg (`winget install Gyan.FFmpeg`).

```powershell
npm install
npm run dev
```

Open http://localhost:5173, go to **Keys & models**, and paste:

- **Groq API key** (transcription): console.groq.com
- **Anthropic API key** (captions and edit plans): console.anthropic.com. This is billed per use, separately from a Claude.ai subscription.

`npm start` builds once and serves everything at http://localhost:4747.

Add videos on the **Drop videos** node, or copy them into `data/inbox/`. Then press **Run everything**, or turn on **Running**.

### Try it without keys

`npx tsx tests/demo-server.ts` runs the app with a stand-in writing model and local Whisper (`pip install openai-whisper`). Its data goes to `data-demo/`.

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
| `npm test` | Vitest, 50 tests: thumbnail scoring, caption prompts, scheduler rules, format helpers, the timeline compiler, the full pipeline over HTTP, and a real Remotion render of a first version and a revised one |
| `npm run test:e2e` | Playwright, 29 tests in a real Chromium: every page and panel, uploading and dropping videos, Run everything and Running, caption rules and style training, scheduler changes, the office canvas (including a live hand-off reel and the batch celebration), the editor → Review → revise loop, and keys never reaching the browser |
| `npm run test:all` | Typecheck, then both of the above |

The first time, install the test browser with `npx playwright install chromium`. The UI tests build the app and start their own server on port 4848 with a fresh data folder each run (`tests/e2e-server.ts`). After a failure, `npx playwright show-trace` opens the saved trace from `test-results/`.
