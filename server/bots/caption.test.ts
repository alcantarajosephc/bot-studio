import { describe, expect, it } from "vitest";
import { buildCaptionPrompt, buildCaptionSchema, clampRules, finalCaptionText, CaptionSchema } from "./caption.ts";
import { DEFAULT_SETTINGS } from "../config.ts";
import { PLATFORM_LIMITS, platformCaptionCap, platformCopyText, selectedPlatforms } from "../../shared/platforms.ts";
import type { CaptionVariant } from "../../shared/types.ts";

const rules = DEFAULT_SETTINGS.captionRules;
const all = selectedPlatforms(rules);

describe("SEO caption prompt", () => {
  it("includes the transcript and the user's rules", () => {
    const p = buildCaptionPrompt({
      transcript: "today I show you how to grow on tiktok",
      fileName: "video1.mp4",
      rules: { ...rules, language: "en", keywordCount: 4, hashtags: true, hashtagCount: 3, maxLength: 200, notes: "always mention my shop" },
      training: "",
      platforms: all,
    });
    expect(p.prompt).toContain("grow on tiktok");
    expect(p.system).toMatch(/English/);
    expect(p.system).toContain("4");
    expect(p.system).toContain("3 hashtags");
    expect(p.system).toContain("200");
    expect(p.system).toContain("always mention my shop");
  });

  it("asks for Taglish or Tagalog when chosen", () => {
    expect(buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, language: "taglish" }, training: "", platforms: all }).system).toMatch(/Taglish/);
    expect(buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, language: "tl" }, training: "", platforms: all }).system).toMatch(/Tagalog/);
  });

  it("tells the model not to use hashtags when they're off", () => {
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, hashtags: false }, training: "", platforms: all });
    expect(p.system).toMatch(/no hashtags/i);
  });

  it("adds training captions as style examples", () => {
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules, training: "My old caption: sulit na sulit!", platforms: all });
    expect(p.system).toContain("sulit na sulit");
  });

  it("names only the selected platforms and communicates each platform's cap (AC-2, AC-4)", () => {
    const tiktokOnly = selectedPlatforms({ platforms: ["tiktok"] });
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules: { ...rules, maxLength: 120 }, training: "", platforms: tiktokOnly });
    // The output block requests only the selected platform's key.
    expect(p.system).toContain('(key "tiktok")');
    expect(p.system).not.toContain('(key "youtube")');
    expect(p.system).not.toContain('(key "instagram")');
    // TikTok cap = min(PLATFORM_LIMITS.tiktok.caption, maxLength) = min(150, 120) = 120.
    expect(p.system).toContain("120 characters");

    const yt = buildCaptionPrompt({ transcript: "x", fileName: "a", rules, training: "", platforms: all });
    expect(yt.system).toContain('(key "youtube")');
    expect(yt.system).toContain(`${PLATFORM_LIMITS.youtube.title} characters`);
  });

  it("falls back to single-caption output instructions when no platform is selected (AC-9)", () => {
    const p = buildCaptionPrompt({ transcript: "x", fileName: "a", rules, training: "", platforms: [] });
    expect(p.system).toContain("Return one caption");
    expect(p.system).not.toContain("variants");
  });
});

describe("widened caption schema (AC-1)", () => {
  it("validates one shape per selected platform and rejects unknown keys", () => {
    const schema = buildCaptionSchema(all);
    const valid = {
      keywords: ["grow on tiktok"],
      variants: {
        youtube: { title: "T", description: "D", hashtags: [] },
        tiktok: { caption: "hook", hashtags: ["x"] },
        instagram: { caption: "hook", hashtags: [] },
        facebook: { caption: "hook", hashtags: [] },
      },
    };
    expect(() => schema.parse(valid)).not.toThrow();
    // Unknown platform key is rejected.
    expect(() => schema.parse({ ...valid, variants: { ...valid.variants, snapchat: { caption: "x", hashtags: [] } } })).toThrow();
    // Unknown field inside a variant is rejected.
    expect(() => schema.parse({ ...valid, variants: { ...valid.variants, tiktok: { caption: "x", hashtags: [], bogus: 1 } } })).toThrow();
  });
});

describe("platform limits and caps (AC-4)", () => {
  it("keeps limits as plain editable constants", () => {
    expect(typeof PLATFORM_LIMITS.youtube.title).toBe("number");
    expect(typeof PLATFORM_LIMITS.tiktok.caption).toBe("number");
  });

  it("caps a caption platform at most the creator's maxLength", () => {
    expect(platformCaptionCap("tiktok", 120)).toBe(120); // min(150, 120)
    expect(platformCaptionCap("tiktok", 300)).toBe(150); // min(150, 300)
  });
});

describe("selectedPlatforms allowlist (AC-9, security)", () => {
  it("filters junk, unknown, duplicate and non-array values to the canonical allowlist", () => {
    expect(selectedPlatforms({ platforms: ["tiktok", "tiktok", "snapchat", "youtube", 5, null] as unknown as string[] }).map((p) => p.id)).toEqual(["youtube", "tiktok"]);
    expect(selectedPlatforms({ platforms: "youtube" as unknown as string[] })).toEqual([]);
    expect(selectedPlatforms({ platforms: undefined as unknown as string[] })).toEqual([]);
    expect(selectedPlatforms({} as { platforms?: string[] })).toEqual([]);
  });
});

describe("platformCopyText (AC-7)", () => {
  const yt: CaptionVariant = { platform: "youtube", label: "YouTube Shorts", title: "My Title", description: "My desc", hashtags: ["a", "#b"] };
  const tk: CaptionVariant = { platform: "tiktok", label: "TikTok", caption: "Hook line", hashtags: ["x"] };

  it("joins YouTube title + description, with hashtags per the rule", () => {
    expect(platformCopyText(yt, { hashtags: true })).toBe("My Title\n\nMy desc\n\n#a #b");
    expect(platformCopyText(yt, { hashtags: false })).toBe("My Title\n\nMy desc");
  });

  it("returns the hook caption with its hashtags for TikTok/Reels", () => {
    expect(platformCopyText(tk, { hashtags: true })).toBe("Hook line\n\n#x");
    expect(platformCopyText(tk, { hashtags: false })).toBe("Hook line");
  });
});

describe("clampRules", () => {
  it("floors, ceilings and replaces non-finite numbers", () => {
    expect(clampRules({ ...rules, maxLength: -5, keywordCount: NaN, hashtagCount: 999 })).toMatchObject({ maxLength: 50, keywordCount: 5, hashtagCount: 30 });
  });
});

describe("final caption text", () => {
  it("appends hashtags with # once, when enabled", () => {
    const out = CaptionSchema.parse({ caption: "How to grow on TikTok fast", keywords: ["grow on tiktok"], hashtags: ["#tiktoktips", "growth"] });
    expect(finalCaptionText(out, { ...rules, hashtags: true })).toBe("How to grow on TikTok fast\n\n#tiktoktips #growth");
    expect(finalCaptionText(out, { ...rules, hashtags: false })).toBe("How to grow on TikTok fast");
  });
});
