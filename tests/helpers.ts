import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Providers } from "../server/providers/index.ts";
import type { LlmProvider, GenerateObjectOptions } from "../server/providers/llm/types.ts";
import type { Transcriber } from "../server/providers/transcribe.ts";
import type { Transcript } from "../shared/types.ts";
import { tempDir } from "./fixtures.ts";

/** Point the app at a fresh temp data folder. Call before creating the system. */
export async function freshDataDir(): Promise<string> {
  const dir = tempDir("bots-data-");
  process.env.BOTS_DATA_DIR = dir;
  const { resetSettingsCache } = await import("../server/config.ts");
  resetSettingsCache();
  return dir;
}

export class FakeLlm implements LlmProvider {
  readonly name = "fake";
  calls: GenerateObjectOptions<unknown>[] = [];
  constructor(private reply: (opts: GenerateObjectOptions<unknown>) => unknown) {}
  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<T> {
    this.calls.push(opts as GenerateObjectOptions<unknown>);
    return opts.schema.parse(await this.reply(opts as GenerateObjectOptions<unknown>));
  }
}

export class FakeTranscriber implements Transcriber {
  readonly name = "fake";
  calls = 0;
  /** Make the next N calls throw. */
  failNext = 0;
  constructor(private result: Transcript | ((file: string) => Transcript)) {}
  async transcribe(file: string): Promise<Transcript> {
    this.calls++;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("audio unreadable");
    }
    return typeof this.result === "function" ? this.result(file) : this.result;
  }
}

export function fakeProviders(llm: LlmProvider, transcriber: Transcriber): Providers {
  return { llm: () => llm, transcriber: () => transcriber };
}

export async function listen(app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, server });
    });
  });
}
