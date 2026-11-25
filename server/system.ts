import fs from "node:fs";
import path from "node:path";
import { Bot } from "./core/bot.ts";
import { EventBus } from "./core/events.ts";
import { Store } from "./core/store.ts";
import type { BotContext } from "./core/context.ts";
import { ensureDirs, getSettings, loadBotMeta, paths } from "./config.ts";
import { defaultProviders, type Providers } from "./providers/index.ts";
import { Manager, VIDEO_EXT } from "./bots/manager.ts";
import { Editor } from "./bots/editor/editor.ts";

export interface BotSystem {
  ctx: BotContext;
  manager: Manager;
  editor: Editor;
  stop: () => Promise<void>;
}

/** Build the whole team: bus, store, one Bot per entry in config/bots.json, manager and editor. */
export function createBotSystem(opts: { providers?: Providers; watchInbox?: boolean } = {}): BotSystem {
  ensureDirs();
  const bus = new EventBus();
  const store = new Store(bus);
  const bots = Object.fromEntries(loadBotMeta().map((m) => [m.id, new Bot(m, bus)])) as BotContext["bots"];
  const ctx: BotContext = { bus, store, bots, providers: opts.providers ?? defaultProviders };
  const manager = new Manager(ctx);
  const editor = new Editor(ctx);
  bots.manager.setStatus("idle", "Inbox is empty");
  recoverInterrupted(ctx);
  if (!getSettings().output.scheduling) bots.scheduler.setStatus("off", "Scheduling is off");
  if (getSettings().running) manager.runEverything();

  let watcher: { close: () => Promise<void> } | null = null;
  if (opts.watchInbox) {
    void import("chokidar").then(({ watch }) => {
      const w = watch(paths.inbox, { ignoreInitial: false, depth: 0, awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 } });
      w.on("add", (file: string) => {
        if (!VIDEO_EXT.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) return;
        void manager.addVideo(file).catch((e) => bus.addLog("Bot Manager", `Could not add ${path.basename(file)}: ${e.message}`, "error"));
      });
      watcher = w;
    });
  }

  return { ctx, manager, editor, stop: async () => { await watcher?.close(); } };
}

/**
 * Work that was mid-way when the app closed would otherwise stay stuck forever.
 * Videos go back to "new" (Run everything picks them up); unfinished edit versions are
 * marked failed so they can be made again.
 */
function recoverInterrupted(ctx: BotContext): void {
  const stuck = ctx.store.videos().filter((v) => v.stage === "thumbnail" || v.stage === "captioning");
  for (const v of stuck) ctx.store.updateVideo(v.id, { stage: "new" });
  if (stuck.length) {
    ctx.bus.addLog("Bot Manager", `${stuck.length} video${stuck.length === 1 ? " was" : "s were"} interrupted when the app closed. Run everything picks ${stuck.length === 1 ? "it" : "them"} up again.`);
  }
  for (const p of ctx.store.projects()) {
    if (!p.versions.some((v) => v.status === "planning" || v.status === "rendering")) continue;
    ctx.store.updateProject(p.id, (x) => {
      for (const v of x.versions) {
        if (v.status === "planning" || v.status === "rendering") {
          v.status = "error";
          v.error = "Stopped because the app was closed. Make the edit again.";
        }
      }
    });
  }
}
