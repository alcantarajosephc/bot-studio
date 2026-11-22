/**
 * Server for the Playwright UI tests: the real app with fake AI providers,
 * so tests are fast, free and need no keys. Every start uses a fresh data folder.
 *   npx tsx tests/e2e-server.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = path.join(os.tmpdir(), "bot-studio-e2e");
fs.rmSync(dataDir, { recursive: true, force: true });
process.env.BOTS_DATA_DIR = dataDir;
const port = Number(process.env.BOTS_PORT ?? 4848);

const { createBotSystem } = await import("../server/system.ts");
const { createApp } = await import("../server/app.ts");
type LlmProvider = import("../server/providers/llm/types.ts").LlmProvider;
type Transcriber = import("../server/providers/transcribe.ts").Transcriber;

const words = [
  { word: "Today", start: 0.3, end: 0.6 },
  { word: "I", start: 0.65, end: 0.7 },
  { word: "show", start: 0.75, end: 1.0 },
  { word: "you", start: 1.05, end: 1.2 },
  { word: "um", start: 1.3, end: 1.5 },
  { word: "three", start: 3.1, end: 3.4 },
  { word: "quick", start: 3.45, end: 3.7 },
  { word: "tips.", start: 3.75, end: 4.2 },
];

const transcriber: Transcriber = {
  name: "e2e",
  async transcribe() {
    return { text: words.map((w) => w.word).join(" "), words };
  },
};

const llm: LlmProvider = {
  name: "e2e",
  async generateObject(opts) {
    await new Promise((r) => setTimeout(r, 300));
    if (opts.system.includes("Video Editor bot")) {
      const revising = opts.system.includes("revising");
      const asset = opts.prompt.match(/^- (.+\.png)$/m)?.[1];
      return opts.schema.parse({
        removeWordRanges: [{ fromWord: 4, toWord: 4, reason: "filler" }],
        emphasisWords: [6],
        callouts: [{ fromWord: 5, toWord: 7, text: "Tip time", position: "top" }],
        inserts: asset ? [{ asset, fromWord: 5, toWord: 7, label: "Example" }] : [],
        zooms: revising ? [{ fromWord: 5, toWord: 7, scale: 1.2 }] : [],
        titleCards: [],
      });
    }
    return opts.schema.parse({ caption: "Three quick tips for beginners", keywords: ["quick tips", "beginner tips"], hashtags: ["tips", "beginners"] });
  },
};

const sys = createBotSystem({ watchInbox: true, providers: { llm: () => llm, transcriber: () => transcriber } });
createApp(sys).listen(port, "127.0.0.1", () => {
  sys.editor.mediaBase = `http://127.0.0.1:${port}`;
  console.log(`e2e server ready on http://127.0.0.1:${port}`);
});
