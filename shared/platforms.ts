// Single source of truth for the caption bot's per-platform variants.
//
// This module is also the trust boundary for platform selection: callers read
// the creator's chosen platforms ONLY through selectedPlatforms(rules), which
// filters the canonical CAPTION_PLATFORMS list. The persisted rules.platforms
// array (user-editable settings.json) is never iterated directly, so schema
// keys, prompt text and tab ids always come from these constants.

import type { CaptionRules, CaptionVariant } from "./types.ts";

export type PlatformId = "youtube" | "tiktok" | "instagram" | "facebook";

/** "title-desc" platforms get a title + description; "caption" platforms get one short hook caption. */
export type PlatformKind = "title-desc" | "caption";

export interface PlatformDef {
  id: PlatformId;
  label: string;
  kind: PlatformKind;
}

/** Supported platforms, in canonical display order. Add one here and it flows everywhere. */
export const CAPTION_PLATFORMS: readonly PlatformDef[] = [
  { id: "youtube", label: "YouTube Shorts", kind: "title-desc" },
  { id: "tiktok", label: "TikTok", kind: "caption" },
  { id: "instagram", label: "Instagram Reels", kind: "caption" },
  { id: "facebook", label: "Facebook Reels", kind: "caption" },
];

/**
 * Editable per-platform character limits. These are simple constants on purpose
 * (format rules drift over time) — adjust the numbers here, no deep logic.
 * The caption cap is further clamped to the creator's maxLength at use-time.
 */
export const PLATFORM_LIMITS = {
  youtube: { title: 100, description: 1000 },
  tiktok: { caption: 150 },
  instagram: { caption: 2200 },
  facebook: { caption: 2200 },
} as const;

/**
 * The allowlist normalizer and trust boundary. Returns the canonical platform
 * defs whose id is present in rules.platforms — allowlisted, de-duplicated and
 * in canonical order regardless of what junk is persisted. An empty result is
 * the single-caption fallback signal.
 */
export function selectedPlatforms(rules: Pick<CaptionRules, "platforms"> | { platforms?: unknown }): PlatformDef[] {
  const sel = (rules as { platforms?: unknown }).platforms;
  return CAPTION_PLATFORMS.filter((p) => Array.isArray(sel) && sel.includes(p.id));
}

/** The TikTok/Reels caption cap: at most the creator's maxLength (AC-4). */
export function platformCaptionCap(id: PlatformId, maxLength: number): number {
  const lim = PLATFORM_LIMITS[id];
  const cap = "caption" in lim ? lim.caption : maxLength;
  return Math.min(cap, maxLength);
}

/** Normalize a hashtag list to a single "#a #b" string (strip leading #, drop inner whitespace). */
export function normalizeHashtags(hashtags: string[]): string {
  return hashtags.map((h) => `#${h.trim().replace(/^#+/, "").replace(/\s+/g, "")}`).join(" ");
}

/**
 * Ready-to-paste text for one platform variant, honoring the hashtag rule.
 * YouTube Shorts = title + blank line + description (+ hashtags if on);
 * TikTok/Reels = caption (+ hashtags if on). Pure function, reused by UI and tests.
 */
export function platformCopyText(variant: CaptionVariant, rules: Pick<CaptionRules, "hashtags">): string {
  const useTags = rules.hashtags && variant.hashtags.length > 0;
  const tags = useTags ? normalizeHashtags(variant.hashtags) : "";
  let body: string;
  if (variant.title !== undefined || variant.description !== undefined) {
    body = [variant.title?.trim(), variant.description?.trim()].filter(Boolean).join("\n\n");
  } else {
    body = (variant.caption ?? "").trim();
  }
  return tags ? `${body}\n\n${tags}` : body;
}
