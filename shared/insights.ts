// Pure, dependency-free helpers that turn the creator's own logged results into
// insights: validating a pasted result, ranking their best posting slots, and
// picking their top-performing captions. Shared by the server and the web app.

import type { VideoRecord } from "./types.ts";

/** Slots with fewer posts than this are "thin" — shown as a range, not a single average. */
export const THIN_DATA_POSTS = 3;
/** Never feed more than this many of the creator's captions into the style guide. */
export const TOP_CAPTIONS_CAP = 3;
/** A sane ceiling so one fat-fingered entry can't dominate the ranking or the display. */
const MAX_COUNT = 10_000_000_000;

export interface ResultsInput {
  views: number;
  likes?: number;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && Number.isFinite(n) && n >= 0 && n <= MAX_COUNT;
}

/**
 * Validate a pasted results object. `views` must be a non-negative whole number;
 * `likes` is optional but, when given, must be one too. Throws a user-facing Error
 * (surfaced as a 400) on anything else — blank, text, negative, fractional, huge.
 */
export function parseResults(input: unknown): ResultsInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Enter a whole number of views (0 or more).");
  }
  const { views, likes } = input as Record<string, unknown>;
  if (!isCount(views)) throw new Error("Enter a whole number of views (0 or more).");
  const out: ResultsInput = { views };
  if (likes !== undefined && likes !== null) {
    if (!isCount(likes)) throw new Error("Enter a whole number of likes (0 or more).");
    out.likes = likes;
  }
  return out;
}

export interface BestTimeSlot {
  /** e.g. "Tue 7 PM". */
  label: string;
  weekday: string;
  hour: number;
  /** How many of the creator's posts landed in this slot (sample size). */
  count: number;
  avg: number;
  min: number;
  max: number;
  /** Fewer than THIN_DATA_POSTS posts — present as a range, not a precise average. */
  thin: boolean;
}

/** Weekday + hour-of-day of an ISO time, read in the schedule's own time zone. */
function slotParts(iso: string, timeZone: string): { weekday: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { weekday: String(parts.weekday), hour: Number(parts.hour) };
}

function fmtHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * Rank the creator's posting slots (weekday + hour-of-day) by average logged views,
 * highest first. Only videos that have both a schedule and recorded views count.
 * Returns [] when there's nothing logged yet (an empty "no data yet" state).
 */
export function rankBestTimes(videos: VideoRecord[], timeZone: string): BestTimeSlot[] {
  const groups = new Map<string, { weekday: string; hour: number; views: number[] }>();
  for (const v of videos) {
    if (!v.schedule?.at || typeof v.results?.views !== "number") continue;
    const { weekday, hour } = slotParts(v.schedule.at, timeZone);
    const key = `${weekday}-${hour}`;
    const g = groups.get(key) ?? { weekday, hour, views: [] };
    g.views.push(v.results.views);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g): BestTimeSlot => {
      const count = g.views.length;
      const sum = g.views.reduce((a, b) => a + b, 0);
      return {
        label: `${g.weekday} ${fmtHour(g.hour)}`,
        weekday: g.weekday,
        hour: g.hour,
        count,
        avg: Math.round(sum / count),
        min: Math.min(...g.views),
        max: Math.max(...g.views),
        thin: count < THIN_DATA_POSTS,
      };
    })
    .sort((a, b) => b.avg - a.avg || b.count - a.count);
}

/**
 * The captions of the highest-viewed videos, in descending view order, capped.
 * Only videos with recorded views and a non-empty caption contribute.
 */
export function topCaptions(videos: VideoRecord[], cap = TOP_CAPTIONS_CAP): string[] {
  return videos
    .filter((v) => typeof v.results?.views === "number" && v.caption?.caption.trim())
    .sort((a, b) => b.results!.views - a.results!.views)
    .slice(0, cap)
    .map((v) => v.caption!.caption.trim());
}
