import { describe, expect, it } from "vitest";
import { fromLocalInput, toLocalInput, fmtSlot } from "../app/src/lib/format.ts";
import { fmtBytes, fmtTime, parseTime } from "../shared/format.ts";
import { parseNotes } from "../server/bots/editor/plan.ts";

describe("time zone helpers", () => {
  it("shows a UTC time as Manila local time and back", () => {
    expect(toLocalInput("2026-11-23T01:00:00.000Z", "Asia/Manila")).toBe("2026-11-23T09:00");
    expect(fromLocalInput("2026-11-23T09:00", "Asia/Manila")).toBe("2026-11-23T01:00:00.000Z");
  });
  it("round-trips in a zone with daylight saving", () => {
    const iso = fromLocalInput("2026-07-04T18:30", "America/New_York");
    expect(iso).toBe("2026-07-04T22:30:00.000Z");
    expect(toLocalInput(iso, "America/New_York")).toBe("2026-07-04T18:30");
  });
  it("formats slots like the schedule grid", () => {
    expect(fmtSlot("2026-11-23T04:10:00.000Z", "Asia/Manila")).toBe("Mon 12:10 PM");
  });
});

describe("timestamps", () => {
  it("formats and parses m:ss", () => {
    expect(fmtTime(110.7, 1)).toBe("1:50.7");
    expect(fmtTime(5)).toBe("0:05");
    expect(parseTime("1:50.7")).toBeCloseTo(110.7);
    expect(parseTime("hello")).toBeNull();
  });
  it("parses pasted review notes", () => {
    const n = parseNotes("1:50.7 zoom in on the product\n- 1:32.9 cut this pause\nmake it punchier");
    expect(n[0]).toEqual({ time: 110.7, stamp: "1:50.7", text: "zoom in on the product" });
    expect(n[1].time).toBeCloseTo(92.9);
    expect(n[2]).toEqual({ time: null, stamp: "", text: "make it punchier" });
  });
});

describe("byte sizes", () => {
  it("formats the ticket's examples", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(5242880)).toBe("5 MB");
    expect(fmtBytes(1073741824)).toBe("1 GB");
  });
  it("uses 1024-based unit boundaries", () => {
    expect(fmtBytes(1024)).toBe("1 KB");
    expect(fmtBytes(1048576)).toBe("1 MB");
  });
  it("rounds to at most one decimal", () => {
    expect(fmtBytes(1587)).toBe("1.5 KB");
  });
  it("returns '0 B' for negative or non-finite input", () => {
    expect(fmtBytes(-1)).toBe("0 B");
    expect(fmtBytes(NaN)).toBe("0 B");
    expect(fmtBytes(Infinity)).toBe("0 B");
    expect(fmtBytes(-Infinity)).toBe("0 B");
  });
});
