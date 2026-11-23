import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CaptionRules, CaptionVariant } from "../../shared/types.ts";
import type { BotContext } from "../core/context.ts";
import { getSettings, paths, ROOT } from "../config.ts";
import { extractAudio } from "../media/ffmpeg.ts";
import { PLATFORM_LIMITS, normalizeHashtags, platformCaptionCap, platformCopyText, selectedPlatforms, type PlatformDef } from "../../shared/platforms.ts";

/** Legacy single-caption schema, kept for the no-platform fallback (AC-9). */
export const CaptionSchema = z.object({
  caption: z.string().describe("The caption text, without hashtags."),
  keywords: z.array(z.string()).describe("Search phrases used in the caption."),
  hashtags: z.array(z.string()).describe("Hashtags, empty if hashtags are off."),
});
export type CaptionOutput = z.infer<typeof CaptionSchema>;

/**
 * Widen the caption output to one tailored variant per selected platform, built
 * from the canonical platform list (never from persisted input). The variants
 * object only allows the given platform keys, so unknown keys are rejected.
 */
export function buildCaptionSchema(platforms: PlatformDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of platforms) {
    shape[p.id] =
      p.kind === "title-desc"
        ? z.strictObject({
            title: z.string().describe(`${p.label} search title.`),
            description: z.string().describe(`${p.label} description.`),
            hashtags: z.array(z.string()).describe("Hashtags for this platform, empty if hashtags are off."),
          })
        : z.strictObject({
            caption: z.string().describe(`${p.label} short, hook-led caption.`),
            hashtags: z.array(z.string()).describe("Hashtags for this platform, empty if hashtags are off."),
          });
  }
  return z.object({
    keywords: z.array(z.string()).describe("Search phrases used across the variants."),
    variants: z.strictObject(shape),
  });
}

const LANGUAGE: Record<CaptionRules["language"], string> = {
  en: "Write the captions in English.",
  tl: "Write the captions in Tagalog (Filipino).",
  taglish: "Write the captions in Taglish: natural Tagalog-English code-switching, the way Filipino creators write. Keep search keywords in the language people actually type them.",
};

const TRAINING_LIMIT = 12_000;

function promptTemplate(): string {
  return fs.readFileSync(path.join(ROOT, "prompts", "caption.md"), "utf8");
}

/** Keep user-editable numeric rules sane before they reach the prompt or a character cap. */
export function clampRules(rules: CaptionRules): CaptionRules {
  const clamp = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback;
  return {
    ...rules,
    keywordCount: clamp(rules.keywordCount, 1, 30, 5),
    hashtagCount: clamp(rules.hashtagCount, 1, 30, 5),
    maxLength: clamp(rules.maxLength, 50, 5000, 300),
  };
}

/** The per-platform output instructions (or the single-caption fallback when no platform is selected). */
function platformsBlock(platforms: PlatformDef[], rules: CaptionRules): string {
  if (platforms.length === 0) {
    return 'Return one caption in "caption", the search phrases in "keywords", and the hashtags in "hashtags".';
  }
  const lines = platforms.map((p) => {
    if (p.kind === "title-desc") {
      return `- ${p.label} (key "${p.id}"): a search "title" (max ${PLATFORM_LIMITS.youtube.title} characters) and a "description" (max ${PLATFORM_LIMITS.youtube.description} characters), plus its own "hashtags".`;
    }
    return `- ${p.label} (key "${p.id}"): one short, hook-led "caption" (max ${platformCaptionCap(p.id, rules.maxLength)} characters), plus its own "hashtags".`;
  });
  return [
    'Return the search phrases once in "keywords", and a "variants" object whose keys are exactly these platform keys and no others:',
    lines.join("\n"),
    "Tailor each version to its platform's format and character limit while following every rule above.",
  ].join("\n");
}

export function buildCaptionPrompt(input: { transcript: string; fileName: string; rules: CaptionRules; training: string; platforms: PlatformDef[] }): { system: string; prompt: string } {
  const rules = clampRules(input.rules);
  const ruleLines = [
    LANGUAGE[rules.language],
    `Use about ${rules.keywordCount} search keywords or phrases, worked into the text naturally.`,
    rules.hashtags ? `Add ${rules.hashtagCount} hashtags (return them in "hashtags", not in the caption).` : "Use no hashtags. Return empty hashtags lists.",
    `Keep each caption under ${rules.maxLength} characters.`,
  ];
  if (rules.notes.trim()) ruleLines.push(`Creator's own rules: ${rules.notes.trim()}`);

  let system = promptTemplate()
    .replace("{{RULES}}", ruleLines.map((l) => `- ${l}`).join("\n"))
    .replace("{{PLATFORMS}}", platformsBlock(input.platforms, rules));
  if (input.training.trim()) {
    system += `\n\n<style_examples>\nThe creator's past captions and notes. Match their voice, word choice and format:\n${input.training.trim()}\n</style_examples>`;
  }
  const prompt = `Video file: ${input.fileName}\n\n<transcript>\n${input.transcript.trim() || "(no speech detected)"}\n</transcript>\n\nWrite the caption.`;
  return { system, prompt };
}

export function finalCaptionText(out: CaptionOutput, rules: CaptionRules): string {
  if (!rules.hashtags || out.hashtags.length === 0) return out.caption.trim();
  return `${out.caption.trim()}\n\n${normalizeHashtags(out.hashtags)}`;
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

/** Newest training text first, capped so the prompt stays a sensible size. */
export function loadTraining(): { text: string; truncated: boolean } {
  let text = "";
  let truncated = false;
  for (const f of trainingFiles()) {
    const t = fs.readFileSync(f, "utf8").trim();
    if (!t) continue;
    if (text.length + t.length > TRAINING_LIMIT) {
      truncated = true;
      break;
    }
    text += (text ? "\n\n---\n\n" : "") + t;
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
  const training = loadTraining();
  if (training.truncated) bot.log("Training text is long; using the newest examples only.");
  const rules = settings.captionRules;
  const platforms = selectedPlatforms(rules);

  if (platforms.length === 0) {
    // AC-9 fallback: no (or no valid) platforms selected -> one usable single caption.
    const { system, prompt } = buildCaptionPrompt({ transcript: transcript.text, fileName: v.originalName, rules, training: training.text, platforms });
    const out = await ctx.providers.llm().generateObject({ system, prompt, schema: CaptionSchema, effort: "medium", maxTokens: 4000 });
    ctx.store.updateVideo(v.id, {
      stage: "captioned",
      caption: { text: finalCaptionText(out, rules), caption: out.caption, keywords: out.keywords, hashtags: out.hashtags, language: rules.language },
    });
    bot.log(`Caption ready for ${v.originalName}: ${out.keywords.slice(0, 6).join(", ")}`);
    return;
  }

  const schema = buildCaptionSchema(platforms);
  const { system, prompt } = buildCaptionPrompt({ transcript: transcript.text, fileName: v.originalName, rules, training: training.text, platforms });
  const out = await ctx.providers.llm().generateObject({ system, prompt, schema, effort: "medium", maxTokens: 4000 });

  // Assemble variants in canonical order from the allowlisted platform list (keys never desync).
  const variants: CaptionVariant[] = platforms.map((p) => {
    const raw = out.variants[p.id] as { title?: string; description?: string; caption?: string; hashtags: string[] };
    return p.kind === "title-desc"
      ? { platform: p.id, label: p.label, title: raw.title, description: raw.description, hashtags: raw.hashtags }
      : { platform: p.id, label: p.label, caption: raw.caption, hashtags: raw.hashtags };
  });

  // Legacy fields stay populated from the primary (first selected) platform for full backward compatibility.
  const primary = variants[0];
  const primaryBody = primary.caption ?? [primary.title?.trim(), primary.description?.trim()].filter(Boolean).join("\n\n");
  ctx.store.updateVideo(v.id, {
    stage: "captioned",
    caption: {
      text: platformCopyText(primary, rules),
      caption: primaryBody,
      keywords: out.keywords,
      hashtags: primary.hashtags,
      language: rules.language,
      variants,
    },
  });
  bot.log(`Caption ready for ${v.originalName}: ${out.keywords.slice(0, 6).join(", ")} (${platforms.map((p) => p.label).join(", ")})`);
}
