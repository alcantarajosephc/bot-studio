/**
 * Test-only server: the real app with a stand-in writing model, so the UI can be
 * clicked through without API keys. Listening uses local Whisper (real).
 *   npx tsx tests/demo-server.ts      (data goes to data-demo/, not data/)
 */
import path from "node:path";
import { ROOT } from "../server/config.ts";

process.env.BOTS_DATA_DIR ??= path.join(ROOT, "data-demo");
const port = Number(process.env.BOTS_PORT ?? 4747);

const { createBotSystem } = await import("../server/system.ts");
const { createApp } = await import("../server/app.ts");
const { LocalWhisperTranscriber } = await import("../server/providers/transcribe.ts");
type LlmProvider = import("../server/providers/llm/types.ts").LlmProvider;

const demoLlm: LlmProvider = {
  name: "demo",
  async generateObject(opts) {
    await new Promise((r) => setTimeout(r, 1200));
    if (opts.system.includes("Video Editor bot")) {
      const n = (opts.prompt.match(/^\[\d+\]/gm) ?? []).length;
      const at = (f: number) => Math.min(n - 1, Math.max(0, Math.floor(n * f)));
      return opts.schema.parse(
        n < 4
          ? { removeWordRanges: [], emphasisWords: [], callouts: [], inserts: [], zooms: [], titleCards: [] }
          : {
              removeWordRanges: [],
              emphasisWords: Array.from({ length: Math.floor(n / 6) }, (_, i) => i * 6 + 2).filter((i) => i < n),
              callouts: [{ fromWord: at(0.1), toWord: at(0.3), text: "Demo banner", position: "top" }],
              inserts: (opts.prompt.match(/^- (.+\.(?:png|jpe?g|webp))$/m) ?? []).slice(1, 2).map((a) => ({ asset: a, fromWord: at(0.5), toWord: at(0.65), label: "Demo label" })),
              zooms: [{ fromWord: at(0.35), toWord: at(0.45), scale: 1.2 }],
              titleCards: opts.system.includes("revising") ? [{ beforeWord: at(0.7), text: "Later that day", seconds: 1.2 }] : [],
            },
      );
    }
    const words = (opts.prompt.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/)?.[1] ?? "").split(/\s+/).filter((w) => w.length > 4);
    const kw = [...new Set(words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")))].filter(Boolean).slice(0, 5);
    return opts.schema.parse({
      caption: `${words.slice(0, 10).join(" ")}... (demo caption, add your Anthropic key for real ones)`,
      keywords: kw,
      hashtags: kw.slice(0, 3).map((k) => `#${k}`),
    });
  },
};

const sys = createBotSystem({
  watchInbox: true,
  providers: { llm: () => demoLlm, transcriber: () => new LocalWhisperTranscriber("base") },
});
createApp(sys).listen(port, "127.0.0.1", () => {
  sys.editor.mediaBase = `http://127.0.0.1:${port}`;
  console.log(`demo server on http://127.0.0.1:${port} (data: ${process.env.BOTS_DATA_DIR})`);
});
