import { describe, expect, it } from "vitest";
import { compileTimeline, outputToSource, chunkCaptions } from "./compile.ts";
import type { EditPlan, Word } from "../../../shared/types.ts";

const empty: EditPlan = { removeWordRanges: [], emphasisWords: [], callouts: [], inserts: [], zooms: [], titleCards: [] };

// "so guys um today I built bots" with a long pause after "guys"
const words: Word[] = [
  { word: "So", start: 0.5, end: 0.7 },
  { word: "guys,", start: 0.75, end: 1.0 },
  { word: "um", start: 3.0, end: 3.3 },
  { word: "today", start: 3.4, end: 3.7 },
  { word: "I", start: 3.75, end: 3.8 },
  { word: "built", start: 3.85, end: 4.1 },
  { word: "bots.", start: 4.15, end: 4.6 },
];
const silences = [
  { start: 0, end: 0.45 },
  { start: 1.05, end: 2.95 },
  { start: 4.65, end: 6 },
];
const opts = { duration: 6, fps: 30, width: 1080, height: 1920, src: "http://x/source.mp4", assetUrl: (a: string) => `http://x/assets/${a}` };

describe("compileTimeline", () => {
  it("cuts long silences but keeps a little breathing room", () => {
    const t = compileTimeline(words, silences, empty, opts);
    // Kept: ~0.33..1.17 and ~2.83..4.77 -> ~2.8s, way under the 6s source.
    expect(t.durationInFrames).toBeGreaterThan(70);
    expect(t.durationInFrames).toBeLessThan(100);
    expect(t.clips.length).toBe(2);
    expect(t.clips[0].from).toBe(0);
    expect(t.clips[1].from).toBe(t.clips[0].durationInFrames);
    const total = t.clips.reduce((n, c) => n + c.durationInFrames, 0);
    expect(total).toBe(t.durationInFrames);
  });

  it("removes the words Claude marked (filler, retakes)", () => {
    const t = compileTimeline(words, silences, { ...empty, removeWordRanges: [{ fromWord: 2, toWord: 2, reason: "filler" }] }, opts);
    const captionText = t.captions.flatMap((c) => c.words.map((w) => w.text)).join(" ");
    expect(captionText).not.toContain("UM");
    expect(captionText).toContain("TODAY");
    const base = compileTimeline(words, silences, empty, opts);
    expect(t.durationInFrames).toBeLessThan(base.durationInFrames);
  });

  it("makes short uppercase captions without trailing punctuation and highlights emphasis words", () => {
    const t = compileTimeline(words, silences, { ...empty, emphasisWords: [5] }, opts);
    const all = t.captions.flatMap((c) => c.words);
    expect(all.map((w) => w.text)).toContain("GUYS");
    expect(all.find((w) => w.text === "BUILT")?.highlight).toBe(true);
    expect(all.find((w) => w.text === "TODAY")?.highlight).toBe(false);
    for (const c of t.captions) expect(c.words.length).toBeLessThanOrEqual(3);
    // captions never overlap
    for (let i = 1; i < t.captions.length; i++) {
      expect(t.captions[i].from).toBeGreaterThanOrEqual(t.captions[i - 1].from + t.captions[i - 1].durationInFrames);
    }
  });

  it("inserts a title card that pushes later clips back", () => {
    const base = compileTimeline(words, silences, empty, opts);
    const t = compileTimeline(words, silences, { ...empty, titleCards: [{ beforeWord: 3, text: "one month later", seconds: 1 }] }, opts);
    expect(t.titleCards).toHaveLength(1);
    expect(t.titleCards[0].durationInFrames).toBe(30);
    expect(t.titleCards[0].text).toBe("ONE MONTH LATER");
    expect(t.durationInFrames).toBe(base.durationInFrames + 30);
    const today = t.captions.find((c) => c.words.some((w) => w.text === "TODAY"))!;
    expect(today.from).toBeGreaterThanOrEqual(t.titleCards[0].from + 30);
  });

  it("splits clips for zooms and maps callouts and inserts onto the cut timeline", () => {
    const t = compileTimeline(
      words,
      silences,
      {
        ...empty,
        zooms: [{ fromWord: 5, toWord: 6, scale: 1.2 }],
        callouts: [{ fromWord: 3, toWord: 6, text: "Step two", position: "top" }],
        inserts: [{ asset: "office.png", fromWord: 3, toWord: 6, label: "Screenshot" }, { asset: "missing.png", fromWord: 0, toWord: 1, label: null }],
      },
      { ...opts, assets: ["office.png"] },
    );
    expect(t.clips.some((c) => c.zoom === 1.2)).toBe(true);
    expect(t.clips.some((c) => c.zoom === 1)).toBe(true);
    expect(t.callouts[0].text).toBe("STEP TWO");
    expect(t.callouts[0].from + t.callouts[0].durationInFrames).toBeLessThanOrEqual(t.durationInFrames);
    expect(t.inserts).toHaveLength(1); // unknown asset dropped
    expect(t.inserts[0].src).toBe("http://x/assets/office.png");
  });

  it("trims dead air before the first word and after the last, even without detected silence", () => {
    const t = compileTimeline(words, [], empty, opts);
    expect(t.clips[0].srcStart).toBeCloseTo(0.25, 2);
    expect(t.clips.at(-1)!.srcEnd).toBeCloseTo(5.1, 2);
  });

  it("works with no speech at all", () => {
    const t = compileTimeline([], [], empty, opts);
    expect(t.durationInFrames).toBe(180);
    expect(t.captions).toHaveLength(0);
  });

  it("ignores out-of-range word indices instead of crashing", () => {
    const t = compileTimeline(words, silences, { ...empty, zooms: [{ fromWord: 40, toWord: 99, scale: 1.3 }], emphasisWords: [999] }, opts);
    expect(t.durationInFrames).toBeGreaterThan(0);
  });
});

describe("outputToSource", () => {
  it("maps a time in the edited video back to the source", () => {
    const t = compileTimeline(words, silences, empty, opts);
    const firstClip = t.clips[1];
    const outSec = (firstClip.from + 15) / 30;
    expect(outputToSource(t, outSec)).toBeCloseTo(firstClip.srcStart + 0.5, 1);
  });
});

describe("chunkCaptions", () => {
  it("breaks on punctuation and long gaps", () => {
    const groups = chunkCaptions(words.map((w, i) => ({ ...w, index: i })));
    expect(groups[0].map((w) => w.word)).toEqual(["So", "guys,"]);
  });
});
