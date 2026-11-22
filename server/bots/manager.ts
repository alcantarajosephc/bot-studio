import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoRecord } from "../../shared/types.ts";
import type { BotContext } from "../core/context.ts";
import { getSettings, paths } from "../config.ts";
import { probe } from "../media/ffmpeg.ts";
import { thumbnailJob } from "./thumbnail.ts";
import { captionJob } from "./caption.ts";
import { schedulerJob } from "./scheduler.ts";
import { postingJob } from "./posting.ts";

const PIPELINE = ["thumbnail", "caption", "scheduler", "posting"];

export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

/**
 * Bot Manager: routes each video through the steps
 *   Drop videos -> Thumbnail Bot -> SEO Caption Bot -> Scheduler Bot -> Posting Bot
 * Every bot is its own worker, so video 2 can get its thumbnail while video 1 is being captioned.
 */
export class Manager {
  private scheduleQueued = false;
  private scheduleChecks = 0;

  constructor(private ctx: BotContext) {
    // Keep the manager's own status in step with the team.
    let pending = false;
    ctx.bus.onEvent((e) => {
      if (e.type !== "bot" || !PIPELINE.includes(e.bot.id) || pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        this.updateStatus();
      }, 0);
    });
  }

  private get bot() {
    return this.ctx.bots.manager;
  }

  private updateStatus(): void {
    const busy = ["thumbnail", "caption", "scheduler"].reduce((n, id) => n + this.ctx.bots[id].pending, 0);
    const next = busy ? `Tracking ${busy} job${busy > 1 ? "s" : ""}` : "Inbox is empty";
    if (this.bot.state.detail === next && this.bot.state.status === (busy ? "working" : "idle")) return;
    this.bot.setStatus(busy ? "working" : "idle", next);
  }

  /** Take a file (upload or inbox) into the library. Moves it into data/videos. */
  async addVideo(srcPath: string, originalName = path.basename(srcPath)): Promise<VideoRecord> {
    const id = randomUUID().slice(0, 8);
    const ext = path.extname(originalName).toLowerCase() || ".mp4";
    const file = `${id}${ext}`;
    const dest = path.join(paths.videos, file);
    try {
      fs.renameSync(srcPath, dest);
    } catch {
      fs.copyFileSync(srcPath, dest);
      fs.rmSync(srcPath, { force: true });
    }
    let duration: number | undefined;
    try {
      duration = (await probe(dest)).duration;
    } catch {
      // still accept it; the thumbnail step will report the problem
    }
    const v = this.ctx.store.addVideo({ id, file, originalName, addedAt: new Date().toISOString(), stage: "new", duration });
    this.bot.log(`Got ${originalName}.`);
    if (getSettings().running) this.process(v.id);
    return v;
  }

  private fail(id: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (this.ctx.store.video(id)) this.ctx.store.updateVideo(id, { stage: "error", error: msg });
    throw err;
  }

  /** Send one video down the pipeline. */
  process(id: string): void {
    const v = this.ctx.store.video(id);
    if (!v) return;
    const { thumbnail, caption } = this.ctx.bots;
    this.bot.log(`${v.originalName} queued for a cover.`);
    thumbnail.enqueue({
      label: v.originalName,
      run: async () => {
        try {
          await thumbnailJob(this.ctx, id);
        } catch (e) {
          this.requestSchedule();
          this.fail(id, e);
        }
        this.bot.log(`${v.originalName} is ready for captioning.`);
        caption.enqueue({
          label: v.originalName,
          run: async () => {
            try {
              await captionJob(this.ctx, id);
            } catch (e) {
              this.fail(id, e);
            } finally {
              this.requestSchedule();
            }
          },
        });
        this.updateStatus();
      },
    });
    this.updateStatus();
  }

  /** Once thumbnails and captions are all done, the Scheduler Bot sets times, then the Posting Bot checks in. */
  requestSchedule(): void {
    // Check after the calling job has fully finished, so its own bot counts as idle.
    this.scheduleChecks++;
    setTimeout(() => {
      this.scheduleChecks--;
      this.scheduleIfIdle();
    }, 0);
  }

  private scheduleIfIdle(): void {
    const { thumbnail, caption, scheduler } = this.ctx.bots;
    if (thumbnail.pending > 0 || caption.pending > 0 || this.scheduleQueued) return;
    this.scheduleQueued = true;
    scheduler.enqueue({
      label: "schedule",
      run: async () => {
        this.scheduleQueued = false;
        const n = await schedulerJob(this.ctx);
        if (n) await postingJob(this.ctx);
        this.updateStatus();
      },
    });
  }

  /** "Run everything": every new or failed video goes through, and anything captioned gets scheduled. */
  runEverything(): number {
    const todo = this.ctx.store.videos().filter((v) => v.stage === "new" || v.stage === "error");
    for (const v of todo) this.process(v.id);
    if (!todo.length) this.requestSchedule();
    this.bot.log(todo.length ? `Running everything: ${todo.length} video${todo.length > 1 ? "s" : ""}.` : "Nothing new. Re-checking the schedule.");
    return todo.length;
  }

  /** Resolves when every pipeline bot is idle (used by tests and the CLI). */
  async settled(): Promise<void> {
    const ids = ["thumbnail", "caption", "scheduler", "posting"];
    for (let i = 0; i < 1000; i++) {
      await Promise.all(ids.map((id) => this.ctx.bots[id].whenIdle()));
      await new Promise((r) => setTimeout(r, 5));
      if (this.scheduleChecks === 0 && ids.every((id) => this.ctx.bots[id].pending === 0)) return;
    }
  }
}
