import { DateTime } from "luxon";
import type { BotContext } from "../core/context.ts";
import { getSettings } from "../config.ts";

/**
 * Posting adapters plug in here later (TikTok, Facebook, Instagram, YouTube).
 * No adapter is connected yet, so the bot only reports what is waiting.
 */
export interface PostingAdapter {
  platform: string;
  post(input: { videoFile: string; caption: string; thumbnail?: string }): Promise<{ url?: string }>;
}

export const postingAdapters: PostingAdapter[] = [];

export async function postingJob(ctx: BotContext): Promise<void> {
  const bot = ctx.bots.posting;
  const waiting = ctx.store.videos().filter((v) => v.stage === "scheduled" && v.schedule);
  if (!postingAdapters.length) {
    const next = waiting.map((v) => v.schedule!.at).sort()[0];
    const tz = getSettings().schedule.timezone;
    const when = next ? DateTime.fromISO(next).setZone(tz).toFormat("ccc d LLL, h:mm a") : null;
    bot.setStatus("off", waiting.length ? `Not connected. ${waiting.length} waiting${when ? `, next ${when}` : ""}` : "Not connected yet");
    if (waiting.length) bot.log(`Not connected to any platform yet. ${waiting.length} video${waiting.length > 1 ? "s" : ""} waiting at their set times.`);
  }
}
