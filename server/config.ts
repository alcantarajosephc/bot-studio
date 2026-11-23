import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BotMeta, PublicSettings, Settings } from "../shared/types.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Everything the app saves lives here, on this computer. Tests point it at a temp folder. */
export function dataDir(): string {
  return process.env.BOTS_DATA_DIR ?? path.join(ROOT, "data");
}

export const paths = {
  get data() { return dataDir(); },
  get inbox() { return path.join(dataDir(), "inbox"); },
  get videos() { return path.join(dataDir(), "videos"); },
  get thumbs() { return path.join(dataDir(), "thumbs"); },
  get training() { return path.join(dataDir(), "training"); },
  get editor() { return path.join(dataDir(), "editor"); },
  get tmp() { return path.join(dataDir(), "tmp"); },
  get settings() { return path.join(dataDir(), "settings.json"); },
  get db() { return path.join(dataDir(), "db.json"); },
};

export function ensureDirs(): void {
  for (const dir of [paths.data, paths.inbox, paths.videos, paths.thumbs, paths.training, paths.editor, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadBotMeta(): BotMeta[] {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "bots.json"), "utf8"));
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { anthropic: "", groq: "" },
  // Default to the keyless combo: Claude Code CLI for writing + local Whisper for listening, so a fresh install needs no API keys.
  llm: { provider: "claude-code", claudeModel: "claude-opus-5-5", groqModel: "llama-3.3-70b-versatile", claudeCodeModel: "claude-opus-5-5" },
  transcription: { provider: "local", language: "auto", groqModel: "whisper-large-v3", localModel: "small" },
  captionRules: {
    language: "taglish",
    keywordCount: 5,
    hashtags: true,
    hashtagCount: 5,
    maxLength: 300,
    notes: "",
    useTopCaptions: false,
  },
  schedule: {
    days: "every",
    customDays: [1, 3, 5],
    mode: "auto",
    times: ["12:00", "18:00", "21:00"],
    window: { start: "09:00", end: "21:00" },
    perDay: 3,
    timezone: "Asia/Manila",
  },
  running: false,
};

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (!cached) {
    let saved: unknown = {};
    try {
      saved = JSON.parse(fs.readFileSync(paths.settings, "utf8"));
    } catch {
      // first run
    }
    cached = merge(DEFAULT_SETTINGS, saved);
  }
  return cached;
}

export function updateSettings(patch: unknown): Settings {
  const next = merge(getSettings(), patch);
  fs.mkdirSync(paths.data, { recursive: true });
  fs.writeFileSync(paths.settings, JSON.stringify(next, null, 2));
  cached = next;
  return next;
}

/** Forget cached settings (tests switch data folders). */
export function resetSettingsCache(): void {
  cached = null;
}

/** Key from Settings first, then the environment (.env). */
export function apiKey(name: "anthropic" | "groq"): string {
  const s = getSettings().keys[name];
  if (s) return s;
  return (name === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GROQ_API_KEY) ?? "";
}

export function publicSettings(s: Settings = getSettings()): PublicSettings {
  return { ...s, keys: { anthropic: Boolean(apiKey("anthropic")), groq: Boolean(apiKey("groq")) } };
}
