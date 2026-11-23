import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { makeTestVideo, tempDir } from "./fixtures.ts";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir, listen } from "./helpers.ts";
import type { BotSystem } from "../server/system.ts";
import type { Server } from "node:http";

let sys: BotSystem;
let base: string;
let server: Server;
let videoFile: string;
const llm = new FakeLlm(() => ({ caption: "How I grow on TikTok as a beginner", keywords: ["grow on tiktok", "tiktok tips"], hashtags: ["tiktoktips", "#contentcreator"] }));
const transcriber = new FakeTranscriber({ text: "today I will show you how to grow on tiktok", words: [] });

beforeAll(async () => {
  await freshDataDir();
  videoFile = await makeTestVideo(tempDir());
  const { createBotSystem } = await import("../server/system.ts");
  const { createApp } = await import("../server/app.ts");
  sys = createBotSystem({ providers: fakeProviders(llm, transcriber) });
  ({ base, server } = await listen(createApp(sys)));
});

afterAll(async () => {
  server?.close();
  await sys?.stop();
});

async function upload(names: string[]) {
  const form = new FormData();
  for (const n of names) form.append("videos", new Blob([fs.readFileSync(videoFile)]), n);
  const res = await fetch(`${base}/api/videos`, { method: "POST", body: form });
  return (await res.json()) as { added: { id: string }[] };
}

describe("bot pipeline", () => {
  it("takes dropped videos through thumbnail -> caption -> schedule -> posting", async () => {
    const { added } = await upload(["video1.mp4", "video2.mp4", "video3.mp4", "notes.txt"]);
    expect(added).toHaveLength(3); // the .txt is ignored

    // Not running yet: nothing happens until "Run everything".
    expect(sys.ctx.store.videos().every((v) => v.stage === "new")).toBe(true);

    const run = await (await fetch(`${base}/api/run`, { method: "POST" })).json();
    expect(run.started).toBe(3);
    await sys.manager.settled();

    const videos = sys.ctx.store.videos();
    for (const v of videos) {
      expect(v.stage).toBe("scheduled");
      expect(v.thumbnail?.file).toBeTruthy();
      expect(fs.existsSync(path.join(process.env.BOTS_DATA_DIR!, "thumbs", v.thumbnail!.file))).toBe(true);
      expect(v.caption?.text).toBe("How I grow on TikTok as a beginner\n\n#tiktoktips #contentcreator");
      expect(DateTime.fromISO(v.schedule!.at) > DateTime.now()).toBe(true);
    }
    // under 10 videos -> one day
    const tz = "Asia/Manila";
    expect(new Set(videos.map((v) => DateTime.fromISO(v.schedule!.at).setZone(tz).toISODate())).size).toBe(1);
    // in order
    const times = videos.map((v) => v.schedule!.at);
    expect([...times].sort()).toEqual(times);

    // The caption bot was given the transcript and the creator's rules.
    expect(llm.calls[0].prompt).toContain("grow on tiktok");
    expect(llm.calls[0].system).toMatch(/Taglish/);

    const state = await (await fetch(`${base}/api/state`)).json();
    const msgs: string[] = state.log.map((l: { bot: string; message: string }) => `${l.bot}: ${l.message}`);
    expect(msgs.some((m) => m.startsWith("Bot Manager: video1.mp4 is ready for captioning"))).toBe(true);
    expect(msgs.some((m) => /Thumbnail Bot: video1.mp4: cover taken from 0:0\d \(clearest, best-exposed frame\)/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("SEO Caption Bot: Caption ready for video1.mp4"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Scheduler Bot: Scheduled 3 videos"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Posting Bot: Not connected"))).toBe(true);
    const posting = state.bots.find((b: { meta: { id: string } }) => b.meta.id === "posting");
    expect(posting.state.status).toBe("off");
  });

  it("lets you edit a caption, give a video its own time, and reorder", async () => {
    const [a, b] = sys.ctx.store.videos();
    await fetch(`${base}/api/videos/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captionText: "my own caption" }) });
    expect(sys.ctx.store.video(a.id)!.caption!.text).toBe("my own caption");

    const at = DateTime.now().plus({ days: 5 }).startOf("hour").toUTC().toISO()!;
    await fetch(`${base}/api/videos/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule: { at } }) });
    expect(sys.ctx.store.video(b.id)!.schedule).toEqual({ at, manual: true });

    await fetch(`${base}/api/videos/${a.id}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: 1 }) });
    await new Promise((r) => setTimeout(r, 20));
    await sys.manager.settled();
    expect(sys.ctx.store.videos()[0].id).toBe(b.id);
    // manual time survives rescheduling
    expect(sys.ctx.store.video(b.id)!.schedule!.at).toBe(at);
  });

  it("marks a video as failed without stopping the others, and Run everything retries it", async () => {
    const before = sys.ctx.store.videos().length;
    await fetch(`${base}/api/running`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ running: true }) });
    transcriber.failNext = 1;
    await upload(["clip-a.mp4", "clip-b.mp4"]);
    await sys.manager.settled();
    let vids = sys.ctx.store.videos();
    expect(vids).toHaveLength(before + 2);
    const failed = vids.filter((v) => v.stage === "error");
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain("audio unreadable");
    expect(vids.filter((v) => v.originalName.startsWith("clip-")).some((v) => v.stage === "scheduled")).toBe(true);

    await fetch(`${base}/api/run`, { method: "POST" });
    await sys.manager.settled();
    vids = sys.ctx.store.videos();
    expect(vids.every((v) => v.stage === "scheduled")).toBe(true);
  });

  it("saves settings without ever sending keys back", async () => {
    const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: { groq: "gsk_test123" }, captionRules: { language: "en" } }) });
    const s = await res.json();
    expect(s.keys.groq).toBe(true);
    expect(JSON.stringify(s)).not.toContain("gsk_test123");
    expect(s.captionRules.language).toBe("en");
    expect(s.captionRules.keywordCount).toBe(5);
  });

  it("learns from pasted captions and uploaded text files", async () => {
    const form = new FormData();
    form.append("text", "sulit na sulit to mga ka-creator!");
    form.append("files", new Blob(["Always end with a question."]), "style.txt");
    const res = await (await fetch(`${base}/api/caption/train`, { method: "POST", body: form })).json();
    expect(res.saved).toHaveLength(2);
    const { loadTraining } = await import("../server/bots/caption.ts");
    expect(loadTraining().text).toContain("sulit na sulit");
    expect(loadTraining().text).toContain("end with a question");
  });

  it("logs a results number on a scheduled video, persists it, and rejects bad input", async () => {
    const v = sys.ctx.store.videos().find((x) => x.stage === "scheduled")!;
    const res = await fetch(`${base}/api/videos/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results: { views: 12340, likes: 540 } }) });
    expect(res.ok).toBe(true);
    const saved = sys.ctx.store.video(v.id)!;
    expect(saved.results?.views).toBe(12340);
    expect(saved.results?.likes).toBe(540);
    expect(typeof saved.results?.capturedAt).toBe("string");

    // Present on GET /api/state, so it survives a reload.
    const state = await (await fetch(`${base}/api/state`)).json();
    const fromState = state.videos.find((x: { id: string }) => x.id === v.id);
    expect(fromState.results.views).toBe(12340);

    // Invalid input is rejected (400) and leaves the stored results unchanged.
    const bad = await fetch(`${base}/api/videos/${v.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results: { views: -5 } }) });
    expect(bad.status).toBe(400);
    expect(sys.ctx.store.video(v.id)!.results?.views).toBe(12340);
  });
});
