import { describe, expect, it } from "vitest";
import { parseResults, rankBestTimes, topCaptions } from "./insights.ts";
import type { VideoRecord } from "./types.ts";

function vid(p: Partial<VideoRecord>): VideoRecord {
  return { id: Math.random().toString(36).slice(2), file: "f.mp4", originalName: "f.mp4", addedAt: "2026-11-20T00:00:00Z", order: 0, stage: "scheduled", ...p };
}
function caption(text: string): VideoRecord["caption"] {
  return { text, caption: text, keywords: [], hashtags: [], language: "en" };
}

describe("parseResults", () => {
  it("accepts a non-negative whole number of views, with optional likes (AC-2)", () => {
    expect(parseResults({ views: 1200 })).toEqual({ views: 1200 });
    expect(parseResults({ views: 1200, likes: 40 })).toEqual({ views: 1200, likes: 40 });
    expect(parseResults({ views: 0 })).toEqual({ views: 0 });
  });

  it("rejects blank, non-numeric, negative, fractional and non-object input (AC-4)", () => {
    expect(() => parseResults({})).toThrow();
    expect(() => parseResults({ views: "12" })).toThrow();
    expect(() => parseResults({ views: -5 })).toThrow();
    expect(() => parseResults({ views: 1.5 })).toThrow();
    expect(() => parseResults({ views: NaN })).toThrow();
    expect(() => parseResults(null)).toThrow();
    expect(() => parseResults("12")).toThrow();
    expect(() => parseResults([12])).toThrow();
    expect(() => parseResults({ views: 10, likes: -1 })).toThrow();
  });
});

describe("rankBestTimes", () => {
  it("returns an empty list when nothing is logged (AC-5)", () => {
    expect(rankBestTimes([], "UTC")).toEqual([]);
    // a scheduled video with no results contributes nothing
    expect(rankBestTimes([vid({ schedule: { at: "2026-11-24T19:00:00Z", manual: false } })], "UTC")).toEqual([]);
  });

  it("ranks slots by average views descending, counting only videos with recorded views (AC-6, AC-7)", () => {
    const videos = [
      vid({ schedule: { at: "2026-11-24T19:00:00Z", manual: false }, results: { views: 12000, capturedAt: "x" } }), // Tue 7 PM
      vid({ schedule: { at: "2026-12-01T19:00:00Z", manual: false }, results: { views: 13000, capturedAt: "x" } }), // Tue 7 PM
      vid({ schedule: { at: "2026-12-08T19:00:00Z", manual: false }, results: { views: 11000, capturedAt: "x" } }), // Tue 7 PM
      vid({ schedule: { at: "2026-11-28T09:00:00Z", manual: false }, results: { views: 3000, capturedAt: "x" } }), // Sat 9 AM
      vid({ schedule: { at: "2026-12-05T09:00:00Z", manual: false }, results: { views: 8000, capturedAt: "x" } }), // Sat 9 AM
      vid({ schedule: { at: "2026-11-24T19:00:00Z", manual: false } }), // no results -> ignored
    ];
    const slots = rankBestTimes(videos, "UTC");
    expect(slots.map((s) => s.label)).toEqual(["Tue 7 PM", "Sat 9 AM"]);
    expect(slots[0]).toMatchObject({ count: 3, avg: 12000, thin: false });
    expect(slots[1].count).toBe(2);
  });

  it("flags slots with fewer than 3 posts as thin and exposes a min-max range (AC-8)", () => {
    const videos = [
      vid({ schedule: { at: "2026-11-28T09:00:00Z", manual: false }, results: { views: 3000, capturedAt: "x" } }),
      vid({ schedule: { at: "2026-12-05T09:00:00Z", manual: false }, results: { views: 8000, capturedAt: "x" } }),
    ];
    const [slot] = rankBestTimes(videos, "UTC");
    expect(slot.thin).toBe(true);
    expect(slot.min).toBe(3000);
    expect(slot.max).toBe(8000);
  });
});

describe("topCaptions", () => {
  it("returns the highest-viewed captions in descending order, capped at 3 (AC-9)", () => {
    const videos = [
      vid({ results: { views: 500, capturedAt: "x" }, caption: caption("a") }),
      vid({ results: { views: 9000, capturedAt: "x" }, caption: caption("b") }),
      vid({ results: { views: 3000, capturedAt: "x" }, caption: caption("c") }),
      vid({ results: { views: 7000, capturedAt: "x" }, caption: caption("d") }),
      vid({ caption: caption("e") }), // no results -> ignored
      vid({ results: { views: 8000, capturedAt: "x" } }), // no caption -> ignored
    ];
    expect(topCaptions(videos)).toEqual(["b", "d", "c"]);
  });
});
