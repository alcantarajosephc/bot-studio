import { describe, expect, it } from "vitest";
import { buildCaptionPrompt, finalCaptionText, CaptionSchema } from "./caption.ts";
import { DEFAULT_SETTINGS } from "../config.ts";

const rules = DEFAULT_SETTINGS.captionRules;

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
    const out = CaptionSchema.parse({ caption: "How to grow on TikTok fast", keywords: ["grow on tiktok"], hashtags: ["#tiktoktips", "growth"] });
    expect(finalCaptionText(out, { ...rules, hashtags: true })).toBe("How to grow on TikTok fast\n\n#tiktoktips #growth");
    expect(finalCaptionText(out, { ...rules, hashtags: false })).toBe("How to grow on TikTok fast");
  });
});
