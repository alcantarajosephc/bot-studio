import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { candidateTimes, pickBestFrame, scoreFrame, findThumbnail } from "./thumbnail.ts";
import { makeTestVideo, tempDir } from "../../tests/fixtures.ts";

describe("thumbnail scoring", () => {
  it("rates a high-contrast frame sharper than a flat one", () => {
    const w = 8, h = 8;
    const flat = Buffer.alloc(w * h, 128);
    const checker = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) checker[y * w + x] = (x + y) % 2 ? 255 : 0;
    expect(scoreFrame(checker, w, h).sharpness).toBeGreaterThan(scoreFrame(flat, w, h).sharpness);
  });

  it("prefers well-exposed frames over very dark ones", () => {
    const w = 4, h = 4;
    expect(scoreFrame(Buffer.alloc(16, 140), w, h).brightness).toBeGreaterThan(scoreFrame(Buffer.alloc(16, 10), w, h).brightness);
  });

  it("spreads candidate times inside the video, never at 0 or the very end", () => {
    const t = candidateTimes(20);
    expect(t.length).toBeGreaterThan(5);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(Math.min(...t)).toBeGreaterThan(0);
    expect(Math.max(...t)).toBeLessThan(20);
  });

  it("pickBestFrame combines sharpness and brightness", () => {
    const best = pickBestFrame([
      { time: 1, sharpness: 10, brightness: 0.9 },
      { time: 2, sharpness: 100, brightness: 0.9 },
      { time: 3, sharpness: 100, brightness: 0.1 },
    ]);
    expect(best.time).toBe(2);
  });

  it("finds the sharp bright section of a real video and saves a jpg", async () => {
    const dir = tempDir();
    const video = await makeTestVideo(dir);
    const out = path.join(dir, "thumb.jpg");
    const r = await findThumbnail(video, out);
    expect(r.time).toBeGreaterThanOrEqual(2.9);
    expect(r.time).toBeLessThanOrEqual(4.1);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  });
});
