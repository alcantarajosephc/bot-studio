// Types shared by the local server and the web app.

export type BotId =
  | "manager"
  | "thumbnail"
  | "caption"
  | "scheduler"
  | "posting"
  | "editor"
  | "revision";

export type BotStatus = "idle" | "working" | "waiting" | "error" | "off";

/** Static description of a bot (config/bots.json). Add a bot here and it shows up everywhere. */
export interface BotMeta {
  id: BotId | string;
  name: string;
  role: string;
  /** One line shown under the name on the canvas node. */
  tagline: string;
  /** Sprite color key (see shared/sprites.ts palettes). */
  color: string;
  personality: string;
  /** Things the bot says in the office while working / idle. */
  workLines: string[];
  idleLines: string[];
  /** Optional: bot exists but is not wired up yet (e.g. posting). */
  disabled?: boolean;
}

export interface BotState {
  id: string;
  status: BotStatus;
  /** What it is doing right now, e.g. "Captioning video1.mp4". */
  detail: string;
  queue: number;
}

export interface LogEntry {
  id: string;
  at: string; // ISO
  bot: string;
  message: string;
  level?: "info" | "error";
}

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  language?: string;
  words: Word[];
  duration?: number;
}

export type VideoStage =
  | "new"
  | "thumbnail"
  | "captioning"
  | "captioned"
  | "scheduled"
  | "error";

export interface VideoRecord {
  id: string;
  /** File name inside data/videos. */
  file: string;
  originalName: string;
  addedAt: string;
  order: number;
  stage: VideoStage;
  duration?: number;
  thumbnail?: { file: string; time: number; reason: string };
  transcript?: Transcript;
  caption?: { text: string; caption: string; keywords: string[]; hashtags: string[]; language: string };
  schedule?: { at: string; manual: boolean };
  error?: string;
}

export type CaptionLanguage = "en" | "tl" | "taglish";

/** Platform whose hard length ceiling the caption-health check uses. */
export type CaptionPlatform = "tiktok" | "instagram" | "youtube";

export interface CaptionRules {
  language: CaptionLanguage;
  keywordCount: number;
  hashtags: boolean;
  hashtagCount: number;
  maxLength: number;
  notes: string;
  /** Which platform's length ceiling the health check measures against. */
  platform: CaptionPlatform;
  /** Editable risk / strong-language words (comma or newline separated). Seeded English + Taglish. */
  riskWords: string;
  /** Editable overused / banned-generic hashtags (comma or newline separated, with or without #). */
  bannedHashtags: string;
}

/** One advisory caption-health finding. `message` is the "why this hurts reach" line. */
export interface CaptionWarning {
  type:
    | "risk-word"
    | "url"
    | "link-in-bio"
    | "all-caps"
    | "duplicate-hashtag"
    | "banned-hashtag"
    | "hashtag-count"
    | "length";
  /** The offending token, highlighted in the UI. */
  token: string;
  /** One-line, guidance-framed explanation ("may reduce reach"), never a guarantee. */
  message: string;
}

/** Result of the advisory caption-health lint. Never blocks anything. */
export interface CaptionHealth {
  healthy: boolean;
  warnings: CaptionWarning[];
}

export type DayPreset = "every" | "weekdays" | "mwf" | "custom";

export interface ScheduleSettings {
  days: DayPreset;
  /** ISO weekday numbers, 1 = Monday ... 7 = Sunday. Used when days = "custom". */
  customDays: number[];
  /** "auto" = spread evenly inside the window, "times" = use the picked times. */
  mode: "auto" | "times";
  /** "HH:mm" times, up to 20 a day. */
  times: string[];
  window: { start: string; end: string };
  /** Auto spread: posts per day once there are 10 or more videos (max 100). */
  perDay: number;
  timezone: string;
  /** Optional first day (yyyy-MM-dd). Defaults to today. */
  startDate?: string;
}

export interface Settings {
  keys: { anthropic: string; groq: string };
  llm: { provider: "claude" | "groq" | "claude-code"; claudeModel: string; groqModel: string; claudeCodeModel: string };
  transcription: { provider: "groq" | "local"; language: "auto" | "en" | "tl"; groqModel: string; localModel: string };
  captionRules: CaptionRules;
  schedule: ScheduleSettings;
  running: boolean;
}

/** Settings as sent to the browser: keys are masked. */
export type PublicSettings = Omit<Settings, "keys"> & { keys: { anthropic: boolean; groq: boolean } };

/** Result of the Claude Code CLI readiness check (GET /api/claude-code/status). */
export type ClaudeCodeStatus = "checking" | "ok" | "not-found" | "not-signed-in";

// ---------- Video editor ----------

/** What Claude returns. All positions are word indices into the transcript. */
export interface EditPlan {
  removeWordRanges: { fromWord: number; toWord: number; reason: string }[];
  emphasisWords: number[];
  callouts: { fromWord: number; toWord: number; text: string; position: "top" | "middle" }[];
  inserts: { asset: string; fromWord: number; toWord: number; label: string | null }[];
  zooms: { fromWord: number; toWord: number; scale: number }[];
  titleCards: { beforeWord: number; text: string; seconds: number }[];
}

/** Compiled, frame-based timeline the Remotion composition renders. */
export interface Timeline {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  src: string;
  clips: { srcStart: number; srcEnd: number; from: number; durationInFrames: number; zoom: number }[];
  titleCards: { from: number; durationInFrames: number; text: string }[];
  captions: { from: number; durationInFrames: number; words: { text: string; highlight: boolean }[] }[];
  callouts: { from: number; durationInFrames: number; text: string; position: "top" | "middle" }[];
  inserts: { from: number; durationInFrames: number; src: string; label: string | null }[];
}

export interface EditorVersion {
  v: number;
  createdAt: string;
  status: "planning" | "rendering" | "done" | "error";
  progress?: number;
  plan?: EditPlan;
  file?: string;
  durationSec?: number;
  revisionNotes?: string;
  error?: string;
}

export interface RevisionNote {
  id: string;
  version: number;
  /** Seconds in that version's output video. */
  time: number;
  text: string;
  done: boolean;
}

export interface EditorProject {
  id: string;
  name: string;
  createdAt: string;
  source: string;
  assets: string[];
  transcript?: Transcript;
  silences?: { start: number; end: number }[];
  sourceDuration?: number;
  versions: EditorVersion[];
  notes: RevisionNote[];
}

// ---------- Live events (server -> browser over SSE) ----------

export type ServerEvent =
  | { type: "bot"; bot: BotState }
  | { type: "log"; entry: LogEntry }
  | { type: "video"; video: VideoRecord }
  | { type: "video.removed"; id: string }
  | { type: "project"; project: EditorProject }
  | { type: "project.removed"; id: string }
  | { type: "settings"; settings: PublicSettings }
  | { type: "training"; training: { name: string; chars: number }[] };
