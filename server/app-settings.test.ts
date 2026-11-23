import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir, listen } from "../tests/helpers.ts";
import type { BotSystem } from "./system.ts";
import type { PublicSettings } from "../shared/types.ts";

let sys: BotSystem;
let base: string;
let server: Server;

beforeAll(async () => {
  await freshDataDir();
  const { createBotSystem } = await import("./system.ts");
  const { createApp } = await import("./app.ts");
  const llm = new FakeLlm(() => ({}));
  const transcriber = new FakeTranscriber({ text: "", words: [] });
  sys = createBotSystem({ providers: fakeProviders(llm, transcriber) });
  ({ base, server } = await listen(createApp(sys)));
});

afterAll(async () => {
  server?.close();
  await sys?.stop();
});

async function putSettings(body: unknown): Promise<PublicSettings> {
  const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as PublicSettings;
}

describe("PUT /api/settings allowlist", () => {
  it("accepts a known nested field (llm.claudeCodeModel) and drops unknown top-level fields", async () => {
    const s = await putSettings({ llm: { provider: "claude-code", claudeCodeModel: "claude-opus-5-5" }, evilExecutablePath: "/bin/pwned" });
    expect(s.llm.claudeCodeModel).toBe("claude-opus-5-5");
    expect(s.llm.provider).toBe("claude-code");
    expect(JSON.stringify(s)).not.toContain("pwned");
    expect((s as unknown as Record<string, unknown>).evilExecutablePath).toBeUndefined();
  });
});

describe("GET /api/claude-code/status", () => {
  it("returns one of the known status values", async () => {
    const res = await fetch(`${base}/api/claude-code/status`);
    const body = (await res.json()) as { status: string };
    expect(["ok", "not-found", "not-signed-in", "checking"]).toContain(body.status);
  });
});
