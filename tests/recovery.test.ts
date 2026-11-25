import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FakeLlm, FakeTranscriber, fakeProviders, freshDataDir } from "./helpers.ts";
import type { EditorProject, VideoRecord } from "../shared/types.ts";

describe("after the app restarts", () => {
  it("picks interrupted work back up instead of leaving it stuck", async () => {
    const dir = await freshDataDir();
    // State as it was when the app was closed mid-work.
    const videos: VideoRecord[] = [
      { id: "a", file: "a.mp4", originalName: "a.mp4", addedAt: "2026-01-01T00:00:00Z", order: 1, stage: "thumbnail" },
      { id: "b", file: "b.mp4", originalName: "b.mp4", addedAt: "2026-01-01T00:00:00Z", order: 2, stage: "captioning" },
      { id: "c", file: "c.mp4", originalName: "c.mp4", addedAt: "2026-01-01T00:00:00Z", order: 3, stage: "scheduled", schedule: { at: "2030-01-01T00:00:00Z", manual: false } },
    ];
    fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ videos }));
    const project: EditorProject = {
      id: "p1", name: "Edit", createdAt: "2026-01-01T00:00:00Z", source: "source.mp4", assets: [], notes: [],
      versions: [
        { v: 1, createdAt: "2026-01-01T00:00:00Z", status: "done", file: "v1.mp4" },
        { v: 2, createdAt: "2026-01-01T00:00:00Z", status: "rendering", progress: 0.4 },
      ],
    };
    fs.mkdirSync(path.join(dir, "editor", "p1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "editor", "p1", "project.json"), JSON.stringify(project));

    const { createBotSystem } = await import("../server/system.ts");
    const sys = createBotSystem({ providers: fakeProviders(new FakeLlm(() => ({})), new FakeTranscriber({ text: "", words: [] })) });

    const stages = Object.fromEntries(sys.ctx.store.videos().map((v) => [v.id, v.stage]));
    // Interrupted videos go back to "new" so Run everything picks them up; finished ones are untouched.
    expect(stages).toEqual({ a: "new", b: "new", c: "scheduled" });

    const p = sys.ctx.store.project("p1")!;
    expect(p.versions[0].status).toBe("done");
    expect(p.versions[1].status).toBe("error");
    expect(p.versions[1].error).toMatch(/app was closed/i);

    expect(sys.ctx.bus.log.some((l) => /2 videos were interrupted/.test(l.message))).toBe(true);
    await sys.stop();
  });
});
