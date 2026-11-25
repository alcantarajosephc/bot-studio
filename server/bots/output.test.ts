import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { freshDataDir } from "../../tests/helpers.ts";
import { tempDir } from "../../tests/fixtures.ts";
import { fileBaseName, uniqueBase } from "./output.ts";

describe("file names in the output folder", () => {
  it("keeps the original name without its extension", () => {
    expect(fileBaseName("tips-part1.mp4")).toBe("tips-part1");
    expect(fileBaseName("My Video.MOV")).toBe("My Video");
  });
  it("removes characters Windows doesn't allow", () => {
    expect(fileBaseName('a<b>c:d"e/f\\g|h?i*j.mp4')).toBe("a b c d e f g h i j");
    expect(fileBaseName("  ...weird...  .mp4")).toBe("weird");
  });
  it("falls back to a plain name when nothing is left", () => {
    expect(fileBaseName("???.mp4")).toBe("video");
  });
  it("adds (2), (3) when the name is already taken", () => {
    const dir = tempDir();
    expect(uniqueBase(dir, "clip", [".mp4", ".jpg", ".txt"])).toBe("clip");
    fs.writeFileSync(path.join(dir, "clip.txt"), "x");
    expect(uniqueBase(dir, "clip", [".mp4", ".jpg", ".txt"])).toBe("clip (2)");
    fs.writeFileSync(path.join(dir, "clip (2).mp4"), "x");
    expect(uniqueBase(dir, "clip", [".mp4", ".jpg", ".txt"])).toBe("clip (3)");
  });
});

describe("exportVideo", () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await freshDataDir();
  });

  async function setup(names: string[]) {
    const { createBotSystem } = await import("../system.ts");
    const { FakeLlm, FakeTranscriber, fakeProviders } = await import("../../tests/helpers.ts");
    const sys = createBotSystem({ providers: fakeProviders(new FakeLlm(() => ({})), new FakeTranscriber({ text: "", words: [] })) });
    const ids = names.map((name, i) => {
      const id = `v${i}`;
      fs.writeFileSync(path.join(dataDir, "videos", `${id}.mp4`), `video-bytes-${i}`);
      fs.writeFileSync(path.join(dataDir, "thumbs", `${id}.jpg`), `cover-bytes-${i}`);
      sys.ctx.store.addVideo({
        id,
        file: `${id}.mp4`,
        originalName: name,
        addedAt: new Date().toISOString(),
        stage: "captioned",
        thumbnail: { file: `${id}.jpg`, time: 1, reason: "test" },
        caption: { text: `Caption ${i}\n\n#tag${i}`, caption: `Caption ${i}`, keywords: [], hashtags: [`tag${i}`], language: "en" },
      });
      return id;
    });
    return { sys, ids };
  }

  it("puts the video, its cover and its caption side by side in data/output", async () => {
    const { exportVideo } = await import("./output.ts");
    const { sys, ids } = await setup(["tips-part1.mp4"]);
    await exportVideo(sys.ctx, ids[0]);
    const out = path.join(dataDir, "output");
    expect(fs.readFileSync(path.join(out, "tips-part1.mp4"), "utf8")).toBe("video-bytes-0");
    expect(fs.readFileSync(path.join(out, "tips-part1.jpg"), "utf8")).toBe("cover-bytes-0");
    expect(fs.readFileSync(path.join(out, "tips-part1.txt"), "utf8")).toBe("Caption 0\n\n#tag0\n");
    expect(sys.ctx.store.video(ids[0])!.output).toEqual({ folder: out, base: "tips-part1" });
    expect(sys.ctx.bus.log.at(-1)!.message).toMatch(/Saved tips-part1 \(video, cover, caption\)/);
    await sys.stop();
  });

  it("running a video again replaces its own files instead of adding copies", async () => {
    const { exportVideo } = await import("./output.ts");
    const { sys, ids } = await setup(["clip.mp4"]);
    await exportVideo(sys.ctx, ids[0]);
    sys.ctx.store.updateVideo(ids[0], { caption: { ...sys.ctx.store.video(ids[0])!.caption!, text: "New caption" } });
    await exportVideo(sys.ctx, ids[0]);
    const files = fs.readdirSync(path.join(dataDir, "output")).sort();
    expect(files).toEqual(["clip.jpg", "clip.mp4", "clip.txt"]);
    expect(fs.readFileSync(path.join(dataDir, "output", "clip.txt"), "utf8")).toBe("New caption\n");
    await sys.stop();
  });

  it("two different videos with the same name don't overwrite each other", async () => {
    const { exportVideo } = await import("./output.ts");
    const { sys, ids } = await setup(["clip.mp4", "clip.mp4"]);
    await exportVideo(sys.ctx, ids[0]);
    await exportVideo(sys.ctx, ids[1]);
    const out = path.join(dataDir, "output");
    expect(fs.readFileSync(path.join(out, "clip.mp4"), "utf8")).toBe("video-bytes-0");
    expect(fs.readFileSync(path.join(out, "clip (2).mp4"), "utf8")).toBe("video-bytes-1");
    await sys.stop();
  });

  it("uses the folder chosen in Settings", async () => {
    const { exportVideo } = await import("./output.ts");
    const { updateSettings } = await import("../config.ts");
    const custom = tempDir("bots-custom-out-");
    updateSettings({ output: { folder: custom } });
    const { sys, ids } = await setup(["drive.mp4"]);
    await exportVideo(sys.ctx, ids[0]);
    expect(fs.existsSync(path.join(custom, "drive.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "output", "drive.mp4"))).toBe(false);
    await sys.stop();
  });

  it("skips the cover file when there is no cover", async () => {
    const { exportVideo } = await import("./output.ts");
    const { sys, ids } = await setup(["nocover.mp4"]);
    sys.ctx.store.updateVideo(ids[0], { thumbnail: undefined });
    await exportVideo(sys.ctx, ids[0]);
    expect(fs.readdirSync(path.join(dataDir, "output")).sort()).toEqual(["nocover.mp4", "nocover.txt"]);
    await sys.stop();
  });
});
