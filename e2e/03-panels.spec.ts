import { expect, test } from "@playwright/test";
import type { PublicSettings, VideoRecord } from "../shared/types";
import { api, clickNode, drawer, fixture } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("caption rules save", async ({ page }) => {
  await clickNode(page, "caption");
  const d = drawer(page);
  await expect(d.getByRole("button", { name: "Save rules" })).toBeDisabled();
  await d.getByRole("button", { name: "English", exact: true }).click();
  await d.getByLabel("Keywords per caption").fill("7");
  await d.getByRole("checkbox").uncheck();
  await d.getByLabel("Anything else the bot should always do").fill("Mention the link in bio.");
  await d.getByRole("button", { name: "Save rules" }).click();
  await expect(d).toContainText("Saved");

  const s = await api<PublicSettings>(page, "/api/settings");
  expect(s.captionRules).toMatchObject({ language: "en", keywordCount: 7, hashtags: false, notes: "Mention the link in bio." });
});

test("teaching the caption bot your style from pasted text and a file", async ({ page }) => {
  await clickNode(page, "caption");
  const d = drawer(page);
  await d.getByPlaceholder("Paste a few of your best captions here...").fill("Short, friendly, always ends with a question?");
  await d.locator('input[type="file"][accept=".pdf,.docx,.txt,.md"]').setInputFiles({ name: "style.txt", mimeType: "text/plain", buffer: Buffer.from("Use lowercase.") });
  await d.getByRole("button", { name: "Train", exact: true }).click();
  await expect(d).toContainText("Learned from 2 sources.");
  await expect(d.locator(".chip", { hasText: "pasted-captions" })).toBeVisible();
  await expect(d.locator(".chip", { hasText: "style" })).toBeVisible();

  await d.locator(".chip", { hasText: "style" }).getByRole("button").click();
  await expect(d.locator(".chip", { hasText: "style" })).toHaveCount(0);
});

test("editing a caption by hand", async ({ page }) => {
  await clickNode(page, "caption");
  const first = drawer(page).locator(".vitem").first();
  const box = first.locator("textarea");
  await box.fill("My own caption #handmade");
  await first.getByRole("button", { name: "Save caption" }).click();
  await expect(first.getByRole("button", { name: "Save caption" })).toBeDisabled();
  const { videos } = await api<{ videos: VideoRecord[] }>(page, "/api/state");
  expect(videos[0].caption?.text).toBe("My own caption #handmade");
});

test("scheduling is off by default and can be turned on from its panel", async ({ page }) => {
  await clickNode(page, "scheduler");
  const d = drawer(page);
  await expect(d).toContainText("Scheduling is off.");
  await d.getByRole("button", { name: "Turn on scheduling" }).click();
  await expect(d.getByRole("button", { name: "Pick the times" })).toBeVisible();
  // Saved videos now get posting times.
  await expect.poll(async () => (await api<{ videos: VideoRecord[] }>(page, "/api/state")).videos.every((v) => v.stage === "scheduled")).toBe(true);
});

test("scheduler: picked times reschedule every video", async ({ page }) => {
  await clickNode(page, "scheduler");
  const d = drawer(page);
  await d.getByRole("button", { name: "Pick the times" }).click();
  await expect(d.locator('input[type="time"]')).toHaveCount(3);
  await d.getByRole("button", { name: "+ time" }).click();
  await expect(d.locator('input[type="time"]')).toHaveCount(4);
  await d.getByRole("button", { name: "Save and reschedule" }).click();
  await expect(d).toContainText("Saved");

  const s = await api<PublicSettings>(page, "/api/settings");
  expect(s.schedule.mode).toBe("times");
  expect(s.schedule.times).toHaveLength(4);
  // The week grid lists a slot for every video.
  await expect(d.locator(".week .t")).toHaveCount(3);
});

test("scheduler: custom days only allow the chosen weekdays", async ({ page }) => {
  await clickNode(page, "scheduler");
  const d = drawer(page);
  await d.getByRole("button", { name: "My days" }).click();
  // default custom days are Mon/Wed/Fri; add Sunday
  await d.getByRole("button", { name: "Sun", exact: true }).click();
  await d.getByRole("button", { name: "Save and reschedule" }).click();
  await expect(d).toContainText("Saved");
  await expect.poll(async () => {
    const { videos } = await api<{ videos: VideoRecord[] }>(page, "/api/state");
    return videos.every((v) => [1, 3, 5, 7].includes(isoWeekday(v.schedule!.at, "Asia/Manila")));
  }).toBe(true);
});

test("scheduler: reorder and give a video its own time", async ({ page }) => {
  await clickNode(page, "scheduler");
  const d = drawer(page);
  const rows = d.locator(".vlist .vitem");
  const firstName = await rows.first().locator(".title").textContent();
  await rows.first().getByRole("button", { name: "▼" }).click();
  await expect(rows.nth(1).locator(".title")).toHaveText(firstName!);

  const input = rows.first().locator('input[type="datetime-local"]');
  await input.fill("2030-01-15T10:30");
  await expect(rows.first()).toContainText("your time");
  const { videos } = await api<{ videos: VideoRecord[] }>(page, "/api/state");
  const manual = videos.find((v) => v.schedule?.manual)!;
  expect(manual.schedule!.at).toBe("2030-01-15T02:30:00.000Z"); // 10:30 Manila

  await rows.first().getByRole("button", { name: "Let the bot pick" }).click();
  await expect(rows.first()).not.toContainText("your time");
});

test("thumbnail, posting and manager panels show the results", async ({ page }) => {
  await clickNode(page, "thumbnail");
  await expect(drawer(page).locator("figure img")).toHaveCount(3);
  await page.keyboard.press("Escape");

  await clickNode(page, "posting");
  await expect(drawer(page)).toContainText("Posting isn't connected yet");
  await expect(drawer(page)).toContainText("Waiting to post (3)");
  await page.keyboard.press("Escape");

  await clickNode(page, "manager");
  const scheduled = drawer(page).locator(".card", { hasText: "Scheduled" });
  await expect(scheduled).toContainText("3");
});

test("dropping files straight onto the Drop videos node uploads them", async ({ page }) => {
  const fs = await import("node:fs");
  const bytes = fs.readFileSync(fixture("sample.mp4")).toString("base64");
  const dt = await page.evaluateHandle((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bin], "dropped.mp4", { type: "video/mp4" }));
    return data;
  }, bytes);
  const zone = page.locator('.react-flow__node[data-id="drop"] .drop-zone');
  await zone.dispatchEvent("dragover", { dataTransfer: dt });
  await zone.dispatchEvent("drop", { dataTransfer: dt });
  await expect(zone).toContainText("Added 1");
  await expect(page.locator(".botlog")).toContainText("Got dropped.mp4.");
});

function isoWeekday(iso: string, timeZone: string): number {
  const d = new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "short" });
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(d) + 1;
}
