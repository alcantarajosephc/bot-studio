import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { makeTestVideo, tempDir } from "./fixtures.ts";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir, listen } from "./helpers.ts";
import type { BotSystem } from "../server/system.ts";
import type { PublicSettings } from "../shared/types.ts";

let sys: BotSystem;
let base: string;
let server: Server;
let videoFile: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await freshDataDir();
  videoFile = await makeTestVideo(tempDir());
  const { createBotSystem } = await import("../server/system.ts");
  const { createApp } = await import("../server/app.ts");
  const llm = new FakeLlm(() => ({ caption: "Three quick tips", keywords: ["quick tips"], hashtags: ["tips"] }));
  sys = createBotSystem({ providers: fakeProviders(llm, new FakeTranscriber({ text: "three quick tips", words: [] })) });
  ({ base, server } = await listen(createApp(sys)));
});

afterAll(async () => {
  server?.close();
  await sys?.stop();
});

async function upload(names: string[]) {
  const form = new FormData();
  for (const n of names) form.append("videos", new Blob([fs.readFileSync(videoFile)]), n);
  await fetch(`${base}/api/videos`, { method: "POST", body: form });
}

const put = (body: unknown) =>
  fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("output folder (scheduling off, the default)", () => {
  it("starts with scheduling off and shows where files go", async () => {
    const s = (await (await fetch(`${base}/api/settings`)).json()) as PublicSettings;
    expect(s.output.scheduling).toBe(false);
    expect(s.outputDir).toBe(path.join(dataDir, "output"));
    expect(sys.ctx.bots.scheduler.state.status).toBe("off");
  });

  it("finished videos land in the output folder and are not scheduled", async () => {
    await upload(["morning-tips.mp4", "evening-tips.mp4"]);
    await fetch(`${base}/api/run`, { method: "POST" });
    await sys.manager.settled();

    const out = path.join(dataDir, "output");
    expect(fs.readdirSync(out).sort()).toEqual([
      "evening-tips.jpg", "evening-tips.mp4", "evening-tips.txt",
      "morning-tips.jpg", "morning-tips.mp4", "morning-tips.txt",
    ]);
    expect(fs.readFileSync(path.join(out, "morning-tips.txt"), "utf8")).toBe("Three quick tips\n\n#tips\n");
    for (const v of sys.ctx.store.videos()) {
      expect(v.stage).toBe("done");
      expect(v.schedule).toBeUndefined();
    }
    const msgs = sys.ctx.bus.log.map((l) => `${l.bot}: ${l.message}`);
    expect(msgs.some((m) => m.startsWith("Bot Manager: Saved morning-tips (video, cover, caption)"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Scheduler Bot:"))).toBe(false);
    expect(msgs.some((m) => m.startsWith("Posting Bot:"))).toBe(false);
  });

  it("editing a caption updates its .txt file", async () => {
    const v = sys.ctx.store.videos()[0];
    await fetch(`${base}/api/videos/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captionText: "Hand-written caption" }) });
    expect(fs.readFileSync(path.join(dataDir, "output", `${v.output!.base}.txt`), "utf8")).toBe("Hand-written caption\n");
  });

  it("turning scheduling on schedules the saved videos; turning it off clears the times", async () => {
    expect((await put({ output: { scheduling: true } })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    await sys.manager.settled();
    expect(sys.ctx.store.videos().every((v) => v.stage === "scheduled" && v.schedule)).toBe(true);
    expect(sys.ctx.bots.scheduler.state.status).not.toBe("off");

    expect((await put({ output: { scheduling: false } })).status).toBe(200);
    expect(sys.ctx.store.videos().every((v) => v.stage === "done" && !v.schedule)).toBe(true);
    expect(sys.ctx.bots.scheduler.state.status).toBe("off");
  });

  it("only accepts a full folder path for the output folder", async () => {
    const bad = await put({ output: { folder: "relative/folder" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/full folder path/i);

    const custom = tempDir("bots-out-");
    const ok = await put({ output: { folder: custom } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as PublicSettings).outputDir).toBe(custom);
    // Back to the default.
    expect(((await (await put({ output: { folder: "" } })).json()) as PublicSettings).outputDir).toBe(path.join(dataDir, "output"));
  });
});
