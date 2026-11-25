import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir, listen } from "../tests/helpers.ts";
import type { BotSystem } from "./system.ts";
import type { PublicSettings } from "../shared/types.ts";

let sys: BotSystem;
let base: string;
let port: number;
let server: Server;

beforeAll(async () => {
  await freshDataDir();
  const { createBotSystem } = await import("./system.ts");
  const { createApp } = await import("./app.ts");
  sys = createBotSystem({ providers: fakeProviders(new FakeLlm(() => ({})), new FakeTranscriber({ text: "", words: [] })) });
  ({ base, server } = await listen(createApp(sys)));
  port = Number(new URL(base).port);
});

afterAll(async () => {
  server?.close();
  await sys?.stop();
});

/** Raw request so we can set Host and Origin the way a browser on another site would. */
function raw(method: string, pathname: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("only this computer's browser can use the server", () => {
  it("allows normal local requests", async () => {
    expect(await raw("GET", "/api/settings", { Host: `localhost:${port}` })).toBe(200);
    expect(await raw("GET", "/api/settings", { Host: `127.0.0.1:${port}` })).toBe(200);
    expect(await raw("POST", "/api/run", { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).toBe(200);
    // The Vite dev server proxies from port 5173.
    expect(await raw("POST", "/api/run", { Host: `localhost:5173`, Origin: "http://localhost:5173" })).toBe(200);
  });

  it("rejects another website posting to it (cross-site request)", async () => {
    expect(await raw("POST", "/api/run", { Host: `localhost:${port}`, Origin: "https://evil.example" })).toBe(403);
    expect(await raw("POST", "/api/videos", { Host: `localhost:${port}`, Origin: "null" })).toBe(403);
  });

  it("rejects requests addressed to another host name (DNS rebinding)", async () => {
    expect(await raw("GET", "/api/state", { Host: `evil.example:${port}` })).toBe(403);
    expect(await raw("GET", "/media/thumbs/x.jpg", { Host: "attacker.test" })).toBe(403);
  });
});

async function put(body: unknown): Promise<{ status: number; json: PublicSettings & { error?: string } }> {
  const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

describe("settings are checked before saving", () => {
  it("rejects an unknown time zone and keeps the old one", async () => {
    const r = await put({ schedule: { timezone: "Mars/Olympus" } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/time zone/i);
    const s = (await (await fetch(`${base}/api/settings`)).json()) as PublicSettings;
    expect(s.schedule.timezone).toBe("Asia/Manila");
  });

  it("rejects malformed times and an empty posting window", async () => {
    expect((await put({ schedule: { times: ["25:99"] } })).status).toBe(400);
    expect((await put({ schedule: { window: { start: "21:00", end: "09:00" } } })).status).toBe(400);
    expect((await put({ schedule: { customDays: [0, 8] } })).status).toBe(400);
  });

  it("keeps numbers in a sensible range", async () => {
    const r = await put({ schedule: { perDay: 500 }, captionRules: { keywordCount: -3, hashtagCount: 99, maxLength: 10 } });
    expect(r.status).toBe(200);
    expect(r.json.schedule.perDay).toBe(100);
    expect(r.json.captionRules.keywordCount).toBe(1);
    expect(r.json.captionRules.hashtagCount).toBe(30);
    expect(r.json.captionRules.maxLength).toBe(50);
  });

  it("rejects unknown option values", async () => {
    expect((await put({ captionRules: { language: "klingon" } })).status).toBe(400);
    expect((await put({ llm: { provider: "gpt" } })).status).toBe(400);
    expect((await put({ schedule: { days: "sometimes" } })).status).toBe(400);
  });

  it("still accepts a normal update", async () => {
    const r = await put({ schedule: { timezone: "America/New_York", times: ["09:30", "18:00"], perDay: 4 } });
    expect(r.status).toBe(200);
    expect(r.json.schedule).toMatchObject({ timezone: "America/New_York", times: ["09:30", "18:00"], perDay: 4 });
  });
});
