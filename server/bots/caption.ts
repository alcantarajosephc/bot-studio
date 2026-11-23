import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CaptionRules } from "../../shared/types.ts";
import type { BotContext } from "../core/context.ts";
import { getSettings, paths, ROOT } from "../config.ts";
import { extractAudio } from "../media/ffmpeg.ts";
import { topCaptions } from "../../shared/insights.ts";

export const CaptionSchema = z.object({
  caption: z.string().describe("The caption text, without hashtags."),
  keywords: z.array(z.string()).describe("Search phrases used in the caption."),
  hashtags: z.array(z.string()).describe("Hashtags, empty if hashtags are off."),
});
export type CaptionOutput = z.infer<typeof CaptionSchema>;

const LANGUAGE: Record<CaptionRules["language"], string> = {
  en: "Write the caption in English.",
  tl: "Write the caption in Tagalog (Filipino).",
  taglish: "Write the caption in Taglish: natural Tagalog-English code-switching, the way Filipino creators write. Keep search keywords in the language people actually type them.",
};

const TRAINING_LIMIT = 12_000;

function promptTemplate(): string {
  return fs.readFileSync(path.join(ROOT, "prompts", "caption.md"), "utf8");
}

export function buildCaptionPrompt(input: { transcript: string; fileName: string; rules: CaptionRules; training: string }): { system: string; prompt: string } {
  const { rules } = input;
  const ruleLines = [
    LANGUAGE[rules.language],
    `Use about ${rules.keywordCount} search keywords or phrases, worked into the caption naturally.`,
    rules.hashtags ? `Add ${rules.hashtagCount} hashtags (return them in "hashtags", not in the caption).` : "Use no hashtags. Return an empty hashtags list.",
    `Keep the caption under ${rules.maxLength} characters.`,
  ];
  if (rules.notes.trim()) ruleLines.push(`Creator's own rules: ${rules.notes.trim()}`);

  let system = promptTemplate().replace("{{RULES}}", ruleLines.map((l) => `- ${l}`).join("\n"));
  if (input.training.trim()) {
    system += `\n\n<style_examples>\nThe creator's past captions and notes. Match their voice, word choice and format:\n${input.training.trim()}\n</style_examples>`;
  }
  const prompt = `Video file: ${input.fileName}\n\n<transcript>\n${input.transcript.trim() || "(no speech detected)"}\n</transcript>\n\nWrite the caption.`;
  return { system, prompt };
}

export function finalCaptionText(out: CaptionOutput, rules: CaptionRules): string {
  if (!rules.hashtags || out.hashtags.length === 0) return out.caption.trim();
  const tags = out.hashtags.map((h) => `#${h.trim().replace(/^#+/, "").replace(/\s+/g, "")}`).join(" ");
  return `${out.caption.trim()}\n\n${tags}`;
}

// ----- style training -----

function trainingFiles(): string[] {
  if (!fs.existsSync(paths.training)) return [];
  return fs
    .readdirSync(paths.training)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => path.join(paths.training, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

/**
 * Newest training text first, capped so the prompt stays a sensible size.
 * `extra` holds extra style examples (e.g. the creator's top captions) that are
 * appended after the uploaded files; a literal closing tag is stripped so an
 * example can't break out of the <style_examples> block in the prompt.
 */
export function loadTraining(extra: string[] = []): { text: string; truncated: boolean } {
  let text = "";
  let truncated = false;
  const add = (t: string): boolean => {
    if (!t) return true;
    if (text.length + t.length > TRAINING_LIMIT) {
      truncated = true;
      return false;
    }
    text += (text ? "\n\n---\n\n" : "") + t;
    return true;
  };
  for (const f of trainingFiles()) {
    if (!add(fs.readFileSync(f, "utf8").trim())) return { text, truncated };
  }
  for (const e of extra) {
    if (!add(e.replace(/<\/?style_examples>/gi, "").trim())) break;
  }
  return { text, truncated };
}

export function listTraining(): { name: string; chars: number }[] {
  return trainingFiles().map((f) => ({ name: path.basename(f), chars: fs.readFileSync(f, "utf8").length }));
}

export async function extractTrainingText(fileName: string, buf: Buffer): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (ext === ".txt" || ext === ".md") return buf.toString("utf8");
  throw new Error(`Can't read ${ext} files. Use PDF, DOCX or TXT.`);
}

export function saveTraining(name: string, text: string): string {
  fs.mkdirSync(paths.training, { recursive: true });
  const safe = `${Date.now()}-${name.replace(/[^\w.-]+/g, "_").replace(/\.[^.]+$/, "")}.txt`;
  fs.writeFileSync(path.join(paths.training, safe), text.trim());
  return safe;
}

export function deleteTraining(name: string): void {
  const file = path.join(paths.training, path.basename(name));
  if (fs.existsSync(file)) fs.rmSync(file);
}

// ----- the bot job -----

/** SEO Caption Bot job: listen to one video, then write its caption. */
export async function captionJob(ctx: BotContext, videoId: string): Promise<void> {
  const bot = ctx.bots.caption;
  const v = ctx.store.video(videoId);
  if (!v) return;
  const settings = getSettings();
  ctx.store.updateVideo(v.id, { stage: "captioning", error: undefined });

  let transcript = v.transcript;
  if (!transcript) {
    bot.setStatus("working", `Transcribing ${v.originalName}`);
    const audio = path.join(paths.tmp, `${v.id}.mp3`);
    await extractAudio(path.join(paths.videos, v.file), audio);
    try {
      transcript = await ctx.providers.transcriber().transcribe(audio, { language: settings.transcription.language });
    } finally {
      fs.rmSync(audio, { force: true });
    }
    ctx.store.updateVideo(v.id, { transcript });
    bot.log(`Transcribed ${v.originalName}.`);
  }

  bot.setStatus("working", `Captioning ${v.originalName}`);
  const extra = settings.captionRules.useTopCaptions ? topCaptions(ctx.store.videos()) : [];
  const training = loadTraining(extra);
  if (training.truncated) bot.log("Training text is long; using the newest examples only.");
  const { system, prompt } = buildCaptionPrompt({ transcript: transcript.text, fileName: v.originalName, rules: settings.captionRules, training: training.text });
  const out = await ctx.providers.llm().generateObject({ system, prompt, schema: CaptionSchema, effort: "medium", maxTokens: 4000 });
  const text = finalCaptionText(out, settings.captionRules);
  ctx.store.updateVideo(v.id, {
    stage: "captioned",
    caption: { text, caption: out.caption, keywords: out.keywords, hashtags: out.hashtags, language: settings.captionRules.language },
  });
  bot.log(`Caption ready for ${v.originalName}: ${out.keywords.slice(0, 6).join(", ")}`);
}
