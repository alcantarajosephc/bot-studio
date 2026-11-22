import { describe, expect, it } from "vitest";
import { PALETTES, spritePixels, spriteRows, SPRITE_SIZE, type Face } from "./sprites.ts";
import bots from "../config/bots.json" with { type: "json" };

describe("bot sprites", () => {
  const faces: Face[] = ["idle", "blink", "work", "error", "off"];
  it("every face is a full 16x16 grid", () => {
    for (const f of faces) {
      const rows = spriteRows(f);
      expect(rows).toHaveLength(SPRITE_SIZE);
      for (const r of rows) expect(r).toHaveLength(SPRITE_SIZE);
    }
  });
  it("every pixel maps to a color", () => {
    for (const f of faces) {
      const px = spritePixels("blue", f);
      const chars = spriteRows(f).join("");
      const colored = px.flat().filter(Boolean).length;
      expect(colored).toBe([...chars].filter((c) => c !== ".").length);
    }
  });
  it("every bot in config has a palette", () => {
    for (const b of bots) expect(PALETTES[b.color], b.id).toBeTruthy();
  });
});
