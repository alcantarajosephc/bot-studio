/**
 * Checks a settings update before it is saved. Throws a readable Error for values that
 * would break things later (bad time zone, malformed times, unknown options) and clamps
 * numbers into a sensible range. Fields that aren't present are left alone.
 */

import fs from "node:fs";
import path from "node:path";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function oneOf(value: unknown, allowed: readonly string[], label: string): void {
  if (value !== undefined && !allowed.includes(value as string)) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
}

function clampInt(obj: Record<string, unknown>, key: string, min: number, max: number, label: string): void {
  if (obj[key] === undefined) return;
  const n = Number(obj[key]);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  obj[key] = Math.min(max, Math.max(min, Math.round(n)));
}

function text(obj: Record<string, unknown>, key: string, max: number, label: string): void {
  if (obj[key] === undefined) return;
  if (typeof obj[key] !== "string") throw new Error(`${label} must be text.`);
  if ((obj[key] as string).length > max) throw new Error(`${label} is too long (max ${max} characters).`);
}

function bool(obj: Record<string, unknown>, key: string, label: string): void {
  if (obj[key] !== undefined && typeof obj[key] !== "boolean") throw new Error(`${label} must be on or off.`);
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Mutates `body` in place (clamping numbers). `current` is used to check the posting window as a whole. */
export function checkSettingsUpdate(body: Record<string, unknown>, current: { schedule: { window: { start: string; end: string } } }): void {
  const asObj = (v: unknown, label: string): Record<string, unknown> | undefined => {
    if (v === undefined) return undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} is malformed.`);
    return v as Record<string, unknown>;
  };

  bool(body, "running", "Running");

  const out = asObj(body.output, "Output settings");
  if (out) {
    bool(out, "scheduling", "Scheduling");
    text(out, "folder", 500, "Output folder");
    if (typeof out.folder === "string") {
      const folder = out.folder.trim();
      out.folder = folder;
      if (folder && !path.isAbsolute(folder)) throw new Error("Output folder must be a full folder path, like D:\\Videos\\Ready or G:\\My Drive\\Bot Studio.");
      if (folder) {
        try {
          fs.mkdirSync(folder, { recursive: true });
          fs.accessSync(folder, fs.constants.W_OK);
        } catch {
          throw new Error(`Can't write to "${folder}". Pick a folder you can save files in.`);
        }
      }
    }
  }

  const llm = asObj(body.llm, "Writing model settings");
  if (llm) {
    oneOf(llm.provider, ["claude", "claude-code", "groq"], "Writing model");
    for (const k of ["claudeModel", "groqModel", "claudeCodeModel"]) text(llm, k, 100, "Model name");
  }

  const tr = asObj(body.transcription, "Listening settings");
  if (tr) {
    oneOf(tr.provider, ["groq", "local"], "Listening");
    oneOf(tr.language, ["auto", "en", "tl"], "Spoken language");
    for (const k of ["groqModel", "localModel"]) text(tr, k, 100, "Model name");
  }

  const rules = asObj(body.captionRules, "Caption rules");
  if (rules) {
    oneOf(rules.language, ["en", "tl", "taglish"], "Caption language");
    clampInt(rules, "keywordCount", 1, 15, "Keywords per caption");
    clampInt(rules, "hashtagCount", 1, 30, "Hashtag count");
    clampInt(rules, "maxLength", 50, 2200, "Max caption length");
    bool(rules, "hashtags", "Hashtags");
    text(rules, "notes", 2000, "Caption notes");
  }

  const s = asObj(body.schedule, "Schedule");
  if (s) {
    oneOf(s.days, ["every", "weekdays", "mwf", "custom"], "Posting days");
    oneOf(s.mode, ["auto", "times"], "Timing mode");
    if (s.customDays !== undefined) {
      if (!Array.isArray(s.customDays) || s.customDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
        throw new Error("Posting days must be weekdays 1 (Mon) to 7 (Sun).");
      }
    }
    if (s.times !== undefined) {
      if (!Array.isArray(s.times) || s.times.some((t) => typeof t !== "string" || !HHMM.test(t))) throw new Error("Times must look like 09:30.");
      s.times = s.times.slice(0, 20);
    }
    if (s.window !== undefined) {
      const w = { ...current.schedule.window, ...asObj(s.window, "Posting window") };
      if (!HHMM.test(String(w.start)) || !HHMM.test(String(w.end))) throw new Error("Posting window times must look like 09:30.");
      if (minutes(w.end) - minutes(w.start) < 30) throw new Error("The posting window must be at least 30 minutes long.");
    }
    clampInt(s, "perDay", 1, 100, "Posts a day");
    if (s.timezone !== undefined && (typeof s.timezone !== "string" || !isValidTimeZone(s.timezone))) {
      throw new Error(`"${String(s.timezone)}" isn't a time zone. Use a name like Asia/Manila.`);
    }
    if (s.startDate !== undefined && s.startDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(s.startDate))) {
      throw new Error("Start date must look like 2026-12-01.");
    }
  }
}
