import { DateTime } from "luxon";
import type { ScheduleSettings } from "../../shared/types.ts";
import type { BotContext } from "../core/context.ts";
import { getSettings } from "../config.ts";

export const MAX_PICKED_TIMES = 20;
export const MAX_AUTO_PER_DAY = 100;
/** Fewer videos than this all go out on one day (auto spread). */
export const ONE_DAY_THRESHOLD = 10;
const MIN_LEAD_MINUTES = 10;

export function allowedWeekdays(s: ScheduleSettings): number[] {
  switch (s.days) {
    case "every": return [1, 2, 3, 4, 5, 6, 7];
    case "weekdays": return [1, 2, 3, 4, 5];
    case "mwf": return [1, 3, 5];
    case "custom": return [...new Set(s.customDays)].filter((d) => d >= 1 && d <= 7).sort();
  }
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function round5(min: number): number {
  return Math.round(min / 5) * 5;
}

/** Slots (minutes after midnight) for one day. */
function daySlots(day: DateTime, count: number, s: ScheduleSettings, now: DateTime): number[] {
  const isToday = day.hasSame(now, "day");
  const earliest = isToday ? now.hour * 60 + now.minute + MIN_LEAD_MINUTES : -1;

  if (s.mode === "times") {
    return [...new Set(s.times.slice(0, MAX_PICKED_TIMES).map(minutesOf))]
      .sort((a, b) => a - b)
      .filter((m) => m > earliest)
      .slice(0, count);
  }

  let start = minutesOf(s.window.start);
  const end = minutesOf(s.window.end);
  if (isToday) start = Math.max(start, Math.ceil(earliest / 5) * 5);
  if (end - start < 30 || count <= 0) return [];
  if (count === 1) return [round5((start + end) / 2)];
  const step = (end - start) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Round to 5 minutes for tidy times, but never let two posts share a minute.
    const last = out.at(-1) ?? -1;
    const m = Math.max(round5(start + i * step), last + 1);
    out.push(m);
  }
  return out;
}

/**
 * Give every video a posting time.
 * - Videos with their own time (manualAt) keep it.
 * - Auto spread: under 10 videos they all go out on the first open day; 10 or more get perDay a day.
 * - Picked times: each allowed day uses the picked times (up to 20).
 * Returns ISO strings in UTC.
 */
export function planSchedule(videos: { id: string; manualAt?: string }[], s: ScheduleSettings, now: DateTime = DateTime.now()): Record<string, string> {
  const zone = s.timezone || "Asia/Manila";
  const nowZ = now.setZone(zone);
  const out: Record<string, string> = {};
  const queue: string[] = [];
  for (const v of videos) {
    if (v.manualAt) out[v.id] = v.manualAt;
    else queue.push(v.id);
  }
  if (!queue.length) return out;

  const allowed = allowedWeekdays(s);
  if (!allowed.length) throw new Error("Pick at least one posting day.");

  const perDay =
    s.mode === "times"
      ? MAX_PICKED_TIMES
      : queue.length < ONE_DAY_THRESHOLD
        ? queue.length
        : Math.min(Math.max(1, s.perDay), MAX_AUTO_PER_DAY);

  let day = s.startDate ? DateTime.fromISO(s.startDate, { zone }).startOf("day") : nowZ.startOf("day");
  if (day < nowZ.startOf("day")) day = nowZ.startOf("day");

  for (let guard = 0; queue.length && guard < 3660; guard++, day = day.plus({ days: 1 })) {
    if (!allowed.includes(day.weekday)) continue;
    const slots = daySlots(day, Math.min(perDay, queue.length), s, nowZ);
    // Under the one-day rule, wait for a day that fits every video.
    if (s.mode === "auto" && perDay === queue.length && slots.length < queue.length && queue.length < ONE_DAY_THRESHOLD) continue;
    for (const m of slots) {
      const id = queue.shift();
      if (!id) break;
      out[id] = day.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 }).toUTC().toISO()!;
    }
  }
  if (queue.length) throw new Error("Could not find posting slots. Check the days and times.");
  return out;
}

/** Scheduler Bot job: (re)schedule every captioned video that isn't posted yet. */
export async function schedulerJob(ctx: BotContext): Promise<number> {
  const bot = ctx.bots.scheduler;
  const s = getSettings().schedule;
  const videos = ctx.store.videos().filter((v) => v.stage === "captioned" || v.stage === "scheduled");
  if (!videos.length) return 0;
  bot.setStatus("working", `Picking times for ${videos.length} video${videos.length > 1 ? "s" : ""}`);
  const plan = planSchedule(
    videos.map((v) => ({ id: v.id, manualAt: v.schedule?.manual ? v.schedule.at : undefined })),
    s,
  );
  for (const v of videos) {
    ctx.store.updateVideo(v.id, { stage: "scheduled", schedule: { at: plan[v.id], manual: Boolean(v.schedule?.manual) } });
  }
  const days = new Set(Object.values(plan).map((iso) => DateTime.fromISO(iso).setZone(s.timezone).toISODate()));
  bot.log(`Scheduled ${videos.length} video${videos.length > 1 ? "s" : ""} across ${days.size} day${days.size > 1 ? "s" : ""} (${s.timezone}).`);
  return videos.length;
}
