import type { Bot } from "./bot.ts";
import type { EventBus } from "./events.ts";
import type { Store } from "./store.ts";
import type { Providers } from "../providers/index.ts";

/** Everything a bot job needs. Passed in so tests can swap any piece. */
export interface BotContext {
  bus: EventBus;
  store: Store;
  providers: Providers;
  bots: Record<string, Bot> & {
    manager: Bot;
    thumbnail: Bot;
    caption: Bot;
    scheduler: Bot;
    posting: Bot;
    editor: Bot;
    revision: Bot;
  };
}
