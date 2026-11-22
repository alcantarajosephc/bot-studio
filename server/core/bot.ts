import type { BotMeta, BotState, BotStatus } from "../../shared/types.ts";
import type { EventBus } from "./events.ts";

export interface BotJob {
  /** Shown in the bot's status line, e.g. "video1.mp4". */
  label: string;
  run: () => Promise<void>;
}

/**
 * A bot is an independent worker: its own queue, its own status, its own log lines.
 * Bots run in parallel with each other; each bot handles one job at a time.
 */
export class Bot {
  private queue: BotJob[] = [];
  private busy = false;
  private idleWaiters: (() => void)[] = [];
  state: BotState;

  constructor(readonly meta: BotMeta, protected bus: EventBus) {
    this.state = { id: meta.id, status: meta.disabled ? "off" : "idle", detail: meta.idleLines[0] ?? "", queue: 0 };
  }

  get id(): string {
    return this.meta.id;
  }

  log(message: string, level: "info" | "error" = "info"): void {
    this.bus.addLog(this.meta.name, message, level);
  }

  setStatus(status: BotStatus, detail: string): void {
    this.state = { ...this.state, status, detail, queue: this.queue.length };
    this.bus.emit({ type: "bot", bot: this.state });
  }

  enqueue(job: BotJob): void {
    this.queue.push(job);
    this.state.queue = this.queue.length;
    if (!this.busy) void this.drain();
    else this.bus.emit({ type: "bot", bot: this.state });
  }

  get pending(): number {
    return this.queue.length + (this.busy ? 1 : 0);
  }

  /** Resolves once this bot has nothing queued or running. */
  whenIdle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async drain(): Promise<void> {
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      this.state.queue = this.queue.length;
      try {
        await job.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`${job.label}: ${msg}`, "error");
        this.setStatus("error", `${job.label}: ${msg}`);
        continue;
      }
    }
    this.busy = false;
    if (this.state.status !== "error" && this.state.status !== "off") {
      this.setStatus("idle", this.meta.idleLines[0] ?? "Idle");
    }
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((w) => w());
  }
}
