import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EditPlan, Word } from "../../../shared/types.ts";
import { ROOT } from "../../config.ts";
import { fmtTime } from "../../../shared/format.ts";

const range = { fromWord: z.number().int(), toWord: z.number().int() };

export const EditPlanSchema = z.object({
  removeWordRanges: z.array(z.object({ ...range, reason: z.string() })).describe("Words to cut: retakes, false starts, filler, rambling."),
  emphasisWords: z.array(z.number().int()).describe("Word indices to color yellow in the captions."),
  callouts: z.array(z.object({ ...range, text: z.string(), position: z.enum(["top", "middle"]) })).describe("Yellow pill labels."),
  inserts: z.array(z.object({ asset: z.string(), ...range, label: z.string().nullable() })).describe("Screenshots or clips shown at the top of the frame."),
  zooms: z.array(z.object({ ...range, scale: z.number() })).describe("Punch-in zooms, scale 1.1 to 1.3."),
  titleCards: z.array(z.object({ beforeWord: z.number().int(), text: z.string(), seconds: z.number() })).describe("Full-screen black title cards, e.g. a time jump."),
}) satisfies z.ZodType<EditPlan>;

function template(name: string): string {
  return fs.readFileSync(path.join(ROOT, "prompts", name), "utf8");
}

export function wordList(words: Word[]): string {
  return words.map((w, i) => `[${i}] ${w.start.toFixed(2)} ${w.word}`).join("\n");
}

export function buildEditPrompt(input: { words: Word[]; duration: number; assets: string[]; instructions?: string }): { system: string; prompt: string } {
  const assets = input.assets.length ? input.assets.map((a) => `- ${a}`).join("\n") : "(none)";
  const prompt = [
    `Source video length: ${fmtTime(input.duration, 1)} (${input.duration.toFixed(1)}s).`,
    `Long pauses are cut automatically; you don't need to remove silence.`,
    `\n<assets>\n${assets}\n</assets>`,
    input.instructions?.trim() ? `\n<creator_instructions>\n${input.instructions.trim()}\n</creator_instructions>` : "",
    `\n<transcript>\nEach line: [word index] start-seconds word\n${wordList(input.words) || "(no speech)"}\n</transcript>`,
    `\nMake the edit plan.`,
  ].join("\n");
  return { system: template("edit-plan.md"), prompt };
}

export interface MappedNote {
  /** As written by the creator, e.g. "1:50.7". */
  stamp: string;
  text: string;
  /** Nearest word in the source transcript, if the note had a time. */
  word?: { index: number; word: string };
}

/** Parse pasted review notes: one per line, "0:42.5 cut this pause" (time optional). */
export function parseNotes(text: string): { time: number | null; stamp: string; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^\[?((?:\d+:)?\d+(?:\.\d+)?)\]?\s*[-–:]?\s*(.*)$/);
      if (!m || !m[2]) return { time: null, stamp: "", text: l };
      const [mm, ss] = m[1].includes(":") ? m[1].split(":") : ["0", m[1]];
      return { time: Number(mm) * 60 + Number(ss), stamp: m[1], text: m[2] };
    });
}

export function nearestWord(words: Word[], sourceSec: number): { index: number; word: string } | undefined {
  let best = -1;
  let bestD = Infinity;
  words.forEach((w, i) => {
    const d = sourceSec < w.start ? w.start - sourceSec : sourceSec > w.end ? sourceSec - w.end : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best >= 0 ? { index: best, word: words[best].word } : undefined;
}

export function buildRevisePrompt(input: { words: Word[]; duration: number; assets: string[]; previous: EditPlan; version: number; notes: MappedNote[] }): { system: string; prompt: string } {
  const notes = input.notes
    .map((n) => (n.word ? `- At ${n.stamp} in v${input.version} (around word [${n.word.index}] "${n.word.word}"): ${n.text}` : `- ${n.text}`))
    .join("\n");
  const assets = input.assets.length ? input.assets.map((a) => `- ${a}`).join("\n") : "(none)";
  const prompt = [
    `<previous_plan version="${input.version}">\n${JSON.stringify(input.previous, null, 1)}\n</previous_plan>`,
    `\n<revision_notes>\n${notes}\n</revision_notes>`,
    `\n<assets>\n${assets}\n</assets>`,
    `\n<transcript>\nEach line: [word index] start-seconds word (source video, ${input.duration.toFixed(1)}s)\n${wordList(input.words) || "(no speech)"}\n</transcript>`,
    `\nReturn the full revised edit plan.`,
  ].join("\n");
  return { system: template("edit-revise.md") + "\n\n" + template("edit-plan.md"), prompt };
}
