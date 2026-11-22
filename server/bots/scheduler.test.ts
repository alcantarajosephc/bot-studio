import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { planSchedule, allowedWeekdays } from "./scheduler.ts";
import { DEFAULT_SETTINGS } from "../config.ts";
import type { ScheduleSettings } from "../../shared/types.ts";

const TZ = "Asia/Manila";
// Monday 2026-11-23, 08:00 in Manila
const NOW = DateTime.fromISO("2026-11-23T08:00", { zone: TZ });
const base: ScheduleSettings = { ...DEFAULT_SETTINGS.schedule, timezone: TZ };
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}` }));
const local = (iso: string) => DateTime.fromISO(iso).setZone(TZ);

describe("allowedWeekdays", () => {
  it("maps presets to ISO weekdays", () => {
    expect(allowedWeekdays({ ...base, days: "every" })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(allowedWeekdays({ ...base, days: "weekdays" })).toEqual([1, 2, 3, 4, 5]);
    expect(allowedWeekdays({ ...base, days: "mwf" })).toEqual([1, 3, 5]);
    expect(allowedWeekdays({ ...base, days: "custom", customDays: [6, 2] })).toEqual([2, 6]);
  });
});

describe("planSchedule - auto spread", () => {
  it("posts fewer than 10 videos all in one day, in order, inside the window", () => {
    const out = planSchedule(ids(4), { ...base, mode: "auto", window: { start: "09:00", end: "21:00" } }, NOW);
    const times = ["v1", "v2", "v3", "v4"].map((id) => local(out[id]));
    expect(new Set(times.map((t) => t.toISODate())).size).toBe(1);
    expect(times[0].toISODate()).toBe("2026-11-23");
    for (let i = 1; i < times.length; i++) expect(times[i] > times[i - 1]).toBe(true);
    for (const t of times) {
      expect(t.hour).toBeGreaterThanOrEqual(9);
      expect(t.hour * 60 + t.minute).toBeLessThanOrEqual(21 * 60);
      expect(t.minute % 5).toBe(0);
    }
  });

  it("spreads 10 or more videos across days, perDay each", () => {
    const out = planSchedule(ids(12), { ...base, mode: "auto", perDay: 3 }, NOW);
    const byDay = new Map<string, number>();
    for (const iso of Object.values(out)) {
      const d = local(iso).toISODate()!;
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    expect([...byDay.values()]).toEqual([3, 3, 3, 3]);
  });

  it("skips days that aren't allowed (weekdays only)", () => {
    // Friday 2026-11-27 08:00
    const fri = DateTime.fromISO("2026-11-27T08:00", { zone: TZ });
    const out = planSchedule(ids(12), { ...base, mode: "auto", perDay: 3, days: "weekdays" }, fri);
    const weekdays = Object.values(out).map((iso) => local(iso).weekday);
    expect(weekdays.every((d) => d <= 5)).toBe(true);
  });

  it("moves to the next day when today's window is already over", () => {
    const late = DateTime.fromISO("2026-11-23T22:00", { zone: TZ });
    const out = planSchedule(ids(2), base, late);
    expect(local(out.v1).toISODate()).toBe("2026-11-24");
  });

  it("never schedules in the past", () => {
    const noon = DateTime.fromISO("2026-11-23T12:00", { zone: TZ });
    const out = planSchedule(ids(5), base, noon);
    for (const iso of Object.values(out)) expect(local(iso) > noon).toBe(true);
  });

  it("caps perDay at 100", () => {
    const out = planSchedule(ids(150), { ...base, perDay: 500 }, NOW);
    const days = new Set(Object.values(out).map((iso) => local(iso).toISODate()));
    expect(days.size).toBe(2);
  });
});

describe("planSchedule - picked times", () => {
  it("uses the picked times each allowed day", () => {
    const out = planSchedule(ids(5), { ...base, mode: "times", times: ["12:00", "09:30"] }, NOW);
    expect(local(out.v1).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-23 09:30");
    expect(local(out.v2).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-23 12:00");
    expect(local(out.v3).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-24 09:30");
    expect(local(out.v5).toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-25 09:30");
  });

  it("only uses the first 20 picked times a day", () => {
    const times = Array.from({ length: 25 }, (_, i) => `${String(i % 24).padStart(2, "0")}:00`);
    const tomorrow = DateTime.fromISO("2026-11-22T23:59", { zone: TZ });
    const out = planSchedule(ids(21), { ...base, mode: "times", times }, tomorrow);
    expect(local(out.v21).toISODate()).toBe("2026-11-24");
  });

  it("stores times in UTC that match the local time zone", () => {
    const out = planSchedule(ids(1), { ...base, mode: "times", times: ["09:00"] }, NOW);
    expect(out.v1).toBe("2026-11-23T01:00:00.000Z");
  });
});

describe("planSchedule - manual times", () => {
  it("keeps videos that have their own time and schedules the rest around them", () => {
    const out = planSchedule([{ id: "a", manualAt: "2026-12-01T05:00:00.000Z" }, { id: "b" }], base, NOW);
    expect(out.a).toBe("2026-12-01T05:00:00.000Z");
    expect(local(out.b).toISODate()).toBe("2026-11-23");
  });
});

describe("planSchedule - narrow window", () => {
  it("still fits 9 videos in a 30-minute window on one day", () => {
    const out = planSchedule(ids(9), { ...base, window: { start: "10:00", end: "10:30" } }, NOW);
    const t = Object.values(out).map((iso) => local(iso));
    expect(new Set(t.map((x) => x.toISODate())).size).toBe(1);
    expect(new Set(t.map((x) => x.toISO())).size).toBe(9);
  });
});
