import path from "node:path";
import { extractFrame, grayFrames, probe } from "../media/ffmpeg.ts";
import type { BotContext } from "../core/context.ts";
import { paths } from "../config.ts";
import { fmtTime } from "../../shared/format.ts";

export interface FrameScore {
  time: number;
  sharpness: number;
  /** 0..1, 1 = nicely exposed. */
  brightness: number;
}

/** Sharpness = variance of the Laplacian. Brightness = how close the mean is to a well-exposed level. */
export function scoreFrame(buf: Buffer, w: number, h: number): Omit<FrameScore, "time"> {
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += buf[i];
  const mean = sum / (w * h);

  let n = 0, lapSum = 0, lapSq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * buf[i] - buf[i - 1] - buf[i + 1] - buf[i - w] - buf[i + w];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const sharpness = n ? lapSq / n - (lapSum / n) ** 2 : 0;
  const brightness = Math.max(0, 1 - Math.abs(mean - 140) / 140);
  return { sharpness, brightness };
}

export function candidateTimes(duration: number, max = 40): number[] {
  if (duration <= 0) return [0];
  const step = Math.max(0.5, duration / max);
  const times: number[] = [];
  for (let t = step / 2; t < duration - 0.05; t += step) times.push(Number(t.toFixed(3)));
  return times.length ? times : [duration / 2];
}

export function pickBestFrame(scores: FrameScore[]): FrameScore {
  const maxSharp = Math.max(...scores.map((s) => s.sharpness), 1e-9);
  let best = scores[0];
  let bestScore = -1;
  for (const s of scores) {
    const score = 0.6 * (s.sharpness / maxSharp) + 0.4 * s.brightness;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export async function findThumbnail(video: string, out: string): Promise<FrameScore> {
  const info = await probe(video);
  const w = 160;
  const h = Math.max(2, Math.round((160 * (info.height || 284)) / (info.width || 160) / 2) * 2);
  const times = candidateTimes(info.duration);
  const frames = await grayFrames(video, times, w, h);
  const scores = frames.map((buf, i) => ({ time: times[i], ...scoreFrame(buf, w, h) }));
  const best = pickBestFrame(scores);
  await extractFrame(video, best.time, out);
  return best;
}

/** Thumbnail Bot job: pick the cover frame for one video. */
export async function thumbnailJob(ctx: BotContext, videoId: string): Promise<void> {
  const bot = ctx.bots.thumbnail;
  const v = ctx.store.video(videoId);
  if (!v) return;
  bot.setStatus("working", `Picking the cover for ${v.originalName}`);
  ctx.store.updateVideo(v.id, { stage: "thumbnail", error: undefined });
  const file = `${path.parse(v.file).name}.jpg`;
  const best = await findThumbnail(path.join(paths.videos, v.file), path.join(paths.thumbs, file));
  const reason = "clearest, best-exposed frame";
  ctx.store.updateVideo(v.id, { thumbnail: { file, time: best.time, reason } });
  bot.log(`${v.originalName}: cover taken from ${fmtTime(best.time)} (${reason}).`);
  bot.log(`${v.originalName}: thumbnail saved as ${file}.`);
}
