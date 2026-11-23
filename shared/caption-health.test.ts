import { describe, expect, it } from "vitest";
import { ALL_CAPS_MIN, PLATFORM_LIMITS, lintCaption, parseList } from "./caption-health.ts";
import { DEFAULT_SETTINGS } from "../server/config.ts";
import type { CaptionHealth, CaptionWarning } from "./types.ts";

const rules = DEFAULT_SETTINGS.captionRules;
const of = (h: CaptionHealth, type: CaptionWarning["type"]) => h.warnings.filter((w) => w.type === type);

describe("caption health lint", () => {
  it("AC-1: a clean caption is healthy with no warnings", () => {
    const clean = "Natutunan ko kung paano gumawa ng masarap na ulam sa bahay. Subukan niyo rin!\n\n#cooking #recipe #homecook #ulam #masarapNaUlam";
    const h = lintCaption(clean, { ...rules, hashtagCount: 5 });
    expect(h).toEqual({ healthy: true, warnings: [] });
  });

  it("AC-2: flags a seeded English risk word and names it with a 'may reduce reach' reason", () => {
    const h = lintCaption("Join my giveaway today!", { ...rules, hashtags: false });
    const w = of(h, "risk-word");
    expect(w).toHaveLength(1);
    expect(w[0].token).toBe("giveaway");
    expect(w[0].message).toMatch(/reduce this post's reach/);
  });

  it("AC-2: flags a seeded Taglish/Tagalog risk word", () => {
    const h = lintCaption("Panoorin mo, libre ito!", { ...rules, hashtags: false });
    const w = of(h, "risk-word");
    expect(w.map((x) => x.token.toLowerCase())).toContain("libre");
  });

  it("AC-3: flags URLs (http, www and bare domain.tld) in the body", () => {
    for (const url of ["https://bit.ly/x", "www.example.com", "shopee.ph/store"]) {
      const w = of(lintCaption(`Shop here ${url} now`, { ...rules, hashtags: false }), "url");
      expect(w.length, url).toBeGreaterThan(0);
      expect(w[0].message).toMatch(/links in the body/);
    }
  });

  it("AC-3: does not flag a plain filename or decimal as a URL", () => {
    const h = lintCaption("my clip.mp4 is 3.5 stars", { ...rules, hashtags: false });
    expect(of(h, "url")).toHaveLength(0);
  });

  it("AC-3: flags the 'link in bio' phrase", () => {
    const h = lintCaption("Full guide, link in bio!", { ...rules, hashtags: false });
    const w = of(h, "link-in-bio");
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/off-app/);
  });

  it("AC-4: flags an ALL-CAPS run but not short acronyms or brand casing", () => {
    const h = lintCaption("This is CRAZY good, LOL — new TikTok drop", { ...rules, hashtags: false });
    const w = of(h, "all-caps");
    expect(w.map((x) => x.token)).toEqual(["CRAZY"]);
    expect("LOL".length).toBeLessThan(ALL_CAPS_MIN);
  });

  it("AC-5: flags a duplicate hashtag case-insensitively and names it once", () => {
    const h = lintCaption("nice #Love and more #love", { ...rules, hashtags: false });
    const w = of(h, "duplicate-hashtag");
    expect(w).toHaveLength(1);
    expect(w[0].token.toLowerCase()).toBe("#love");
    expect(w[0].message).toMatch(/more than once/);
  });

  it("AC-6: flags a seeded banned-generic hashtag", () => {
    const h = lintCaption("cooking at home #fyp", { ...rules, hashtags: false });
    const w = of(h, "banned-hashtag");
    expect(w).toHaveLength(1);
    expect(w[0].token).toBe("#fyp");
    expect(w[0].message).toMatch(/overused/);
  });

  it("AC-7: flags a hashtag count outside the creator's rule, stating actual vs allowed", () => {
    const h = lintCaption("one tag only #cooking", { ...rules, hashtags: true, hashtagCount: 3 });
    const w = of(h, "hashtag-count");
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain("1 hashtags");
    expect(w[0].message).toContain("rule is 3");
  });

  it("AC-8: flags a caption over the active platform ceiling and names the platform", () => {
    const long = "a".repeat(PLATFORM_LIMITS.tiktok + 10);
    const h = lintCaption(long, { ...rules, hashtags: false, platform: "tiktok" });
    const w = of(h, "length");
    expect(w).toHaveLength(1);
    expect(w[0].token).toBe(String(long.length));
    expect(w[0].message).toContain("TikTok");
    expect(w[0].message).toContain(String(PLATFORM_LIMITS.tiktok));
    // Same text is under YouTube's larger ceiling.
    expect(of(lintCaption(long, { ...rules, hashtags: false, platform: "youtube" }), "length")).toHaveLength(0);
  });

  it("AC-12: risk words are data-driven — present in the list flags, removed does not", () => {
    const caption = "I love mangga season";
    expect(of(lintCaption(caption, { ...rules, hashtags: false, riskWords: "mangga" }), "risk-word")).toHaveLength(1);
    expect(of(lintCaption(caption, { ...rules, hashtags: false, riskWords: "" }), "risk-word")).toHaveLength(0);
  });

  it("AC-12: banned hashtags are data-driven and tolerate a leading #", () => {
    const caption = "post #summer vibes";
    expect(of(lintCaption(caption, { ...rules, hashtags: false, bannedHashtags: "#summer" }), "banned-hashtag")).toHaveLength(1);
    expect(of(lintCaption(caption, { ...rules, hashtags: false, bannedHashtags: "winter" }), "banned-hashtag")).toHaveLength(0);
  });

  it("AC-11: advisory-only — returns a result and never throws for flagged or garbage input", () => {
    const flagged = () => lintCaption("GIVEAWAY link in bio www.scam.com #fyp #fyp", rules);
    expect(flagged).not.toThrow();
    expect(flagged().healthy).toBe(false);
    // Garbage / untrusted rule fields must not crash and must default, not NaN.
    const garbage = lintCaption("hello", { platform: "bogus" as never, riskWords: 42 as never, bannedHashtags: null as never, hashtagCount: NaN as never });
    expect(garbage.warnings.every((w) => !w.message.includes("NaN") && !w.message.includes("undefined"))).toBe(true);
    expect(lintCaption(null, undefined).healthy).toBe(true);
  });

  it("ReDoS guard: regex metacharacters in a user list entry match literally and don't throw", () => {
    const nasty = "a".repeat(5000) + " (a+)+b";
    const run = () => lintCaption(nasty, { ...rules, hashtags: false, riskWords: "(a+)+b" });
    expect(run).not.toThrow();
    expect(of(run(), "risk-word")).toHaveLength(1);
  });

  it("parseList splits, trims, lowercases and de-duplicates", () => {
    expect(parseList("FYP, fyp\n Viral ")).toEqual(["fyp", "viral"]);
    expect(parseList(123 as never)).toEqual([]);
  });
});
