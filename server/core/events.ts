import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { LogEntry, ServerEvent } from "../../shared/types.ts";

const MAX_LOG = 300;

/**
 * One bus for everything. Bots publish here, the Bot Manager listens here,
 * and the browser gets every ServerEvent over SSE.
 */
export class EventBus {
  private emitter = new EventEmitter();
  readonly log: LogEntry[] = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit("event", event);
  }

  onEvent(fn: (e: ServerEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }

  /** Internal pipeline signals between bots (not sent to the browser). */
  signal(name: string, payload: unknown): void {
    this.emitter.emit(`signal:${name}`, payload);
  }

  onSignal<T>(name: string, fn: (payload: T) => void): () => void {
    const h = (p: T) => fn(p);
    this.emitter.on(`signal:${name}`, h);
    return () => this.emitter.off(`signal:${name}`, h);
  }

  addLog(bot: string, message: string, level: "info" | "error" = "info"): LogEntry {
    const entry: LogEntry = { id: randomUUID(), at: new Date().toISOString(), bot, message, level };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.emit({ type: "log", entry });
    return entry;
  }
}
