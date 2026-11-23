// Advisory, no-AI caption "health" lint. Pure string logic shared by the web app
// and the tests. It only reads and returns data — it never throws, never calls the
// network and never blocks saving, editing or scheduling. Framed as guidance, not a
// guarantee, so word lists and platform ceilings are editable in the caption rules.

import type { CaptionHealth, CaptionPlatform, CaptionRules, CaptionWarning } from "./types.ts";

/** A run of this many (or more) uppercase letters reads as shouting. Keeps "LOL"/"TikTok" safe. */
export const ALL_CAPS_MIN = 5;

/** Hard per-platform caption ceilings used by the length check. Guidance values, easy to adjust. */
export const PLATFORM_LIMITS: Record<CaptionPlatform, number> = {
  tiktok: 2200,
  instagram: 2200,
  youtube: 5000,
};

const PLATFORM_LABELS: Record<CaptionPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

const DEFAULT_PLATFORM: CaptionPlatform = "tiktok";

// TLDs we treat as "this is a link", kept to plausible ones so "clip.mp4" / "3.5" aren't flagged.
const URL_TLDS = "com|net|org|co|io|ph|ly|me|tv|shop|store|link|app|xyz|info|biz|ph|gg|to";

/** Split a comma/newline separated list into trimmed, lowercased, de-duplicated entries. */
export function parseList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  for (const raw of value.split(/[\n,]+/)) {
    const entry = raw.trim().toLowerCase();
    if (entry) seen.add(entry);
  }
  return [...seen];
}

/** Escape regex metacharacters so user-supplied list entries can't throw or cause backtracking. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function platformOf(rules: Partial<CaptionRules>): CaptionPlatform {
  const p = rules.platform;
  return p === "tiktok" || p === "instagram" || p === "youtube" ? p : DEFAULT_PLATFORM;
}

/** Hashtags anywhere in the text, with their original casing. Tag string excludes the leading #. */
function parseHashtags(text: string): string[] {
  const out: string[] = [];
  const re = /#([\p{L}\p{N}_]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function riskWordWarnings(text: string, rules: Partial<CaptionRules>): CaptionWarning[] {
  const found: CaptionWarning[] = [];
  const seen = new Set<string>();
  for (const word of parseList(rules.riskWords)) {
    // Whole-word, case-insensitive. Lookarounds (not \b) so Taglish punctuation still matches.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu");
    const m = re.exec(text);
    if (!m) continue;
    const token = m[0];
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      type: "risk-word",
      token,
      message: `“${token}” is a word platforms often flag — it may reduce this post's reach.`,
    });
  }
  return found;
}

function urlWarnings(text: string): CaptionWarning[] {
  const out: CaptionWarning[] = [];
  const seen = new Set<string>();
  const ranges: [number, number][] = [];
  const push = (token: string) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      type: "url",
      token,
      message: `“${token}” is a link in the caption — links in the body can push a post down. Put links in your profile instead.`,
    });
  };

  // Explicit links first: http(s):// or www.
  const explicit = /(?:https?:\/\/|www\.)\S+/gi;
  let m: RegExpExecArray | null;
  while ((m = explicit.exec(text))) {
    ranges.push([m.index, m.index + m[0].length]);
    push(m[0]);
  }
  // Bare domain.tld (single label before a known TLD) that isn't already inside an explicit link.
  const bare = new RegExp(`[a-z0-9][a-z0-9-]*\\.(?:${URL_TLDS})(?:\\/\\S*)?`, "gi");
  while ((m = bare.exec(text))) {
    const start = m.index;
    if (ranges.some(([a, b]) => start >= a && start < b)) continue;
    push(m[0]);
  }
  return out;
}

function linkInBioWarnings(text: string): CaptionWarning[] {
  const m = /link\s+in\s+(?:my\s+|the\s+)?bio/i.exec(text);
  if (!m) return [];
  return [
    {
      type: "link-in-bio",
      token: m[0],
      message: `“link in bio” wording can reduce reach — many platforms suppress posts that point people off-app.`,
    },
  ];
}

function allCapsWarnings(text: string): CaptionWarning[] {
  const out: CaptionWarning[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`\\b[A-Z]{${ALL_CAPS_MIN},}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({
      type: "all-caps",
      token,
      message: `“${token}” is in all caps — shouting can read as spam and may lower reach.`,
    });
  }
  return out;
}

function hashtagWarnings(text: string, rules: Partial<CaptionRules>): CaptionWarning[] {
  const out: CaptionWarning[] = [];
  const tags = parseHashtags(text);

  // Duplicate hashtags (case-insensitive).
  const counts = new Map<string, string>(); // lower -> first-seen casing
  const flaggedDup = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (counts.has(key)) {
      if (!flaggedDup.has(key)) {
        flaggedDup.add(key);
        const shown = counts.get(key)!;
        out.push({
          type: "duplicate-hashtag",
          token: `#${shown}`,
          message: `#${shown} appears more than once — duplicates are ignored and can look spammy.`,
        });
      }
    } else {
      counts.set(key, tag);
    }
  }

  // Banned-generic / overused hashtags from the editable list.
  const banned = new Set(parseList(rules.bannedHashtags).map((t) => t.replace(/^#+/, "")));
  const flaggedBanned = new Set<string>();
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (banned.has(key) && !flaggedBanned.has(key)) {
      flaggedBanned.add(key);
      out.push({
        type: "banned-hashtag",
        token: `#${tag}`,
        message: `#${tag} is an overused, low-reach tag — a more specific hashtag tends to do better.`,
      });
    }
  }

  // Count vs the creator's rule (only when hashtags are enabled and the rule is a real number).
  const allowed = rules.hashtagCount;
  if (rules.hashtags && typeof allowed === "number" && Number.isFinite(allowed) && tags.length !== allowed) {
    out.push({
      type: "hashtag-count",
      token: String(tags.length),
      message: `You have ${tags.length} hashtags; your rule is ${allowed}. Being outside your range can limit reach.`,
    });
  }
  return out;
}

function lengthWarnings(text: string, rules: Partial<CaptionRules>): CaptionWarning[] {
  const platform = platformOf(rules);
  const ceiling = PLATFORM_LIMITS[platform];
  if (text.length <= ceiling) return [];
  return [
    {
      type: "length",
      token: String(text.length),
      message: `${text.length} characters — over ${PLATFORM_LABELS[platform]}'s ${ceiling} limit. The end may be cut off.`,
    },
  ];
}

/**
 * Lint a final/edited caption against the (editable) rules and return an advisory result.
 * Pure and total: tolerates missing/garbage rule fields and never throws.
 */
export function lintCaption(text: unknown, rules: Partial<CaptionRules> = {}): CaptionHealth {
  const str = typeof text === "string" ? text : "";
  const r = rules && typeof rules === "object" ? rules : {};
  const warnings: CaptionWarning[] = [
    ...riskWordWarnings(str, r),
    ...urlWarnings(str),
    ...linkInBioWarnings(str),
    ...allCapsWarnings(str),
    ...hashtagWarnings(str, r),
    ...lengthWarnings(str, r),
  ];
  return { healthy: warnings.length === 0, warnings };
}
