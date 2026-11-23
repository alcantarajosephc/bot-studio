import { describe, expect, it } from "vitest";
import { assembleActiveCaption, buildCaptionPrompt, finalCaptionText, CaptionCandidateSchema, CaptionSchema } from "./caption.ts";
import { DEFAULT_SETTINGS } from "../config.ts";

const rules = DEFAULT_SETTINGS.captionRules;

const candidate = (caption: string, keywords: string[] = ["grow on tiktok"], hashtags: string[] = ["#tiktoktips", "growth"]) => ({ caption, keywords, hashtags });

describe("SEO caption prompt", () => {
  it("includes the transcript and the user's rules", () => {
    const p = buildCaptionPrompt({
      transcript: "today I show you how to grow on tiktok",
      fileName: "video1.mp4",
      rules: { ...rules, language: "en", keywordCount: 4, hashtags: true, hashtagCount: 3, maxLength: 200, notes: "always mention my shop" },
      training: "",
    });
    expect(p.prompt).toContain("grow on tiktok");
    expect(p.system).toMatch(/English/);
    expect(p.system).toContain("4");
    expect(p.system).toContain("3 hashtags");
    expect(p.system).toContain("200");
    expect(p.system).toContain("always mention my shop");
  });

  it("asks for Taglish or Tagalog when chosen", () => {
    expect(buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, language: "taglish" }, training: "" }).system).toMatch(/Taglish/);
    expect(buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, language: "tl" }, training: "" }).system).toMatch(/Tagalog/);
  });

  it("tells the model not to use hashtags when they're off", () => {
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, hashtags: false }, training: "" });
    expect(p.system).toMatch(/no hashtags/i);
  });

  it("adds training captions as style examples", () => {
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules, training: "My old caption: sulit na sulit!" });
    expect(p.system).toContain("sulit na sulit");
  });
});

describe("final caption text", () => {
  it("appends hashtags with # once, when enabled", () => {
    const out = CaptionCandidateSchema.parse({ caption: "How to grow on TikTok fast", keywords: ["grow on tiktok"], hashtags: ["#tiktoktips", "growth"] });
    expect(finalCaptionText(out, { ...rules, hashtags: true })).toBe("How to grow on TikTok fast\n\n#tiktoktips #growth");
    expect(finalCaptionText(out, { ...rules, hashtags: false })).toBe("How to grow on TikTok fast");
  });
});

describe("multi-candidate caption generation", () => {
  const three = {
    captions: [
      candidate("Stop scrolling: here's how to grow on TikTok fast"),
      candidate("The one mistake killing your TikTok reach", ["tiktok reach"], ["#tiktokgrowth"]),
      candidate("I grew to 100k in 30 days — here's the playbook", ["tiktok playbook"], []),
    ],
  };

  it("CaptionSchema parses exactly 3 candidates, each with caption/keywords/hashtags (AC-1)", () => {
    const out = CaptionSchema.parse(three);
    expect(out.captions).toHaveLength(3);
    for (const c of out.captions) {
      expect(typeof c.caption).toBe("string");
      expect(Array.isArray(c.keywords)).toBe(true);
      expect(Array.isArray(c.hashtags)).toBe(true);
    }
  });

  it("rejects a candidate count other than 3 (AC-1)", () => {
    expect(() => CaptionSchema.parse({ captions: [candidate("only one")] })).toThrow();
    expect(() => CaptionSchema.parse({ captions: [...three.captions, candidate("fourth")] })).toThrow();
  });

  it("keeps a distinct opening hook per candidate (AC-2)", () => {
    const out = CaptionSchema.parse(three);
    const hooks = out.captions.map((c) => c.caption.trim().split("\n")[0]);
    expect(new Set(hooks).size).toBe(hooks.length);
  });

  it("assembleActiveCaption on candidate 0 reproduces today's single-caption object (AC-4/AC-6)", () => {
    const out = CaptionSchema.parse(three);
    const active = assembleActiveCaption(out.captions[0], rules, rules.language);
    expect(active).toEqual({
      text: finalCaptionText(out.captions[0], rules),
      caption: out.captions[0].caption,
      keywords: out.captions[0].keywords,
      hashtags: out.captions[0].hashtags,
      language: rules.language,
    });
  });

  it("assembled text is byte-identical to per-candidate finalCaptionText (AC-5)", () => {
    const out = CaptionSchema.parse(three);
    for (const c of out.captions) {
      expect(assembleActiveCaption(c, rules, rules.language).text).toBe(finalCaptionText(c, rules));
    }
  });

  it("prompt asks for 3 options with distinct hooks (AC-3)", () => {
    const p = buildCaptionPrompt({ transcript: "grow on tiktok", fileName: "a.mp4", rules, training: "" });
    expect(p.prompt).toMatch(/3 caption options/i);
    expect(p.system).toMatch(/exactly 3 caption options/i);
    expect(p.system).toMatch(/different hook/i);
  });
});
