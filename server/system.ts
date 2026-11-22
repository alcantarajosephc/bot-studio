import fs from "node:fs";
import path from "node:path";
import { Bot } from "./core/bot.ts";
import { EventBus } from "./core/events.ts";
import { Store } from "./core/store.ts";
import type { BotContext } from "./core/context.ts";
import { ensureDirs, loadBotMeta, paths } from "./config.ts";
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
