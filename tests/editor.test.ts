import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { makeTestVideo, tempDir } from "./fixtures.ts";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir, listen } from "./helpers.ts";
import type { BotSystem } from "../server/system.ts";
import type { EditPlan, EditorProject } from "../shared/types.ts";
import { probe } from "../server/media/ffmpeg.ts";

let sys: BotSystem;
let base: string;
let server: Server;
let fixtures: string;

const words = [
  { word: "So", start: 0.3, end: 0.5 },
  { word: "guys,", start: 0.55, end: 1.0 },
  { word: "um", start: 1.2, end: 1.5 },
  { word: "I", start: 3.1, end: 3.2 },
  { word: "built", start: 3.25, end: 3.6 },
  { word: "bots.", start: 3.65, end: 4.2 },
];
const firstPlan: EditPlan = {
  removeWordRanges: [{ fromWord: 2, toWord: 2, reason: "filler" }],
  emphasisWords: [4],
  callouts: [{ fromWord: 3, toWord: 5, text: "Step two", position: "top" }],
  inserts: [{ asset: "shot.png", fromWord: 3, toWord: 5, label: "Screenshot" }],
  zooms: [],
  titleCards: [],
};
const llm = new FakeLlm((opts) => (opts.system.includes("revising") ? { ...firstPlan, zooms: [{ fromWord: 3, toWord: 5, scale: 1.25 }] } : firstPlan));

beforeAll(async () => {
  await freshDataDir();
  fixtures = tempDir();
  await makeTestVideo(fixtures);
  const { run } = await import("../server/media/ffmpeg.ts");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=orange:s=640x400", "-frames:v", "1", path.join(fixtures, "shot.png")]);
  const { createBotSystem } = await import("../server/system.ts");
  const { createApp } = await import("../server/app.ts");
  sys = createBotSystem({ providers: fakeProviders(llm, new FakeTranscriber({ text: "So guys, um I built bots.", words })) });
  ({ base, server } = await listen(createApp(sys)));
  sys.editor.mediaBase = base;
}, 120_000);

afterAll(async () => {
  server?.close();
  await sys?.stop();
});

async function waitFor(id: string, pred: (p: EditorProject) => boolean, ms = 300_000): Promise<EditorProject> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = sys.ctx.store.project(id)!;
    if (pred(p)) return p;
    if (p.versions.some((v) => v.status === "error")) throw new Error(p.versions.find((v) => v.status === "error")!.error);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out");
}

describe("Video Editor + Review", () => {
  it("edits a raw video into v1, then revises it into v2 from timestamped notes", async () => {
    const form = new FormData();
    form.append("name", "Test edit");
    form.append("video", new Blob([fs.readFileSync(path.join(fixtures, "sample.mp4"))]), "raw.mp4");
    form.append("assets", new Blob([fs.readFileSync(path.join(fixtures, "shot.png"))]), "shot.png");
    const created = (await (await fetch(`${base}/api/projects`, { method: "POST", body: form })).json()) as EditorProject;
    expect(created.assets).toEqual(["shot.png"]);

    const p1 = await waitFor(created.id, (p) => p.versions[0]?.status === "done");
    const v1 = p1.versions[0];
    const out1 = path.join(sys.ctx.store.projectDir(created.id), v1.file!);
    const info = await probe(out1);
    expect(info.width).toBe(1080);
    expect(info.height).toBe(1920);
    // silences and the "um" were cut
    expect(info.duration).toBeLessThan(5);
    expect(info.duration).toBeGreaterThan(1.5);
    expect(llm.calls[0].prompt).toContain("[2] 1.20 um");
    expect(llm.calls[0].prompt).toContain("shot.png");

    // Review: add a note on v1, then paste notes to revise
    const noteRes = await fetch(`${base}/api/projects/${created.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, time: 1.2, text: "zoom in on the product" }),
    });
    expect((await noteRes.json()).text).toBe("zoom in on the product");

    await fetch(`${base}/api/projects/${created.id}/revise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "0:01.2 zoom in on the product" }),
    });
    const p2 = await waitFor(created.id, (p) => p.versions[1]?.status === "done");
    const reviseCall = llm.calls.at(-1)!;
    expect(reviseCall.prompt).toMatch(/At 0:01\.2 in v1 \(around word \[\d\] "[^"]+"\): zoom in on the product/);
    expect(p2.versions[1].plan!.zooms).toHaveLength(1);
    expect(p2.notes.every((n) => n.done)).toBe(true);
    expect(fs.existsSync(path.join(sys.ctx.store.projectDir(created.id), "v2.mp4"))).toBe(true);
  }, 600_000);
});
