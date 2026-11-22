import { expect, test } from "@playwright/test";
import type { VideoRecord } from "../shared/types";
import { api, clickNode, closeDrawer, drawer, fixture } from "./helpers";

test.describe.configure({ mode: "serial" });

test("videos added in the library wait until Run everything", async ({ page }) => {
  await page.goto("/");
  await clickNode(page, "drop");
  await expect(drawer(page)).toContainText("Drop videos");
  await drawer(page).locator('input[type="file"]').setInputFiles([fixture("clip1.mp4"), fixture("clip2.mp4"), fixture("clip3.mp4")]);
  await expect(drawer(page)).toContainText("Added 3 videos. Press Run everything to start.");
  await expect(drawer(page).locator(".vitem")).toHaveCount(3);
  await expect(drawer(page).locator(".vitem .chip", { hasText: "waiting" })).toHaveCount(3);
  await closeDrawer(page);

  await expect(page.locator('.react-flow__node[data-id="drop"] .chip')).toHaveText(["clip1.mp4", "clip2.mp4", "clip3.mp4"]);
  await expect(page.locator(".botlog")).toContainText("Got clip3.mp4.");
  // Paused: nothing has moved on.
  await page.waitForTimeout(500);
  const videos = await api<{ videos: VideoRecord[] }>(page, "/api/state");
  expect(videos.videos.every((v) => v.stage === "new")).toBe(true);
});

test("Run everything sends every video through all the bots", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Run everything/ }).click();

  const log = page.locator(".botlog");
  await expect(log).toContainText("Running everything: 3 videos.");
  await expect(log).toContainText(/clip1\.mp4: cover taken from 0:0\d \(clearest, best-exposed frame\)/);
  await expect(log).toContainText("Transcribed clip1.mp4.");
  await expect(log).toContainText("Caption ready for clip1.mp4: quick tips, beginner tips");
  await expect(log).toContainText("Scheduled 3 videos across 1 day (Asia/Manila).", { timeout: 45_000 });
  await expect(log).toContainText("Not connected to any platform yet. 3 videos waiting at their set times.");

  // Canvas nodes show the results.
  await expect(page.locator('.react-flow__node[data-id="thumbnail"] .thumbs img')).toHaveCount(3);
  await expect(page.locator('.react-flow__node[data-id="caption"] .chip-yellow')).toHaveText(["quick tips", "beginner tips"]);
  await expect(page.locator('.react-flow__node[data-id="scheduler"] .slot')).toHaveCount(3);
  await expect(page.locator('.react-flow__node[data-id="drop"] .chip-green')).toHaveCount(3);

  // Every bot is back to idle; posting reports what's waiting.
  for (const name of ["Bot Manager", "Thumbnail Bot", "SEO Caption Bot", "Scheduler Bot"]) {
    await expect(page.locator(".statusrow", { hasText: name }).locator(".pill").last()).toHaveText("idle");
  }
  await expect(page.locator(".statusrow", { hasText: "Posting Bot" })).toContainText(/Not connected\. 3 waiting, next/);

  const { videos } = await api<{ videos: VideoRecord[] }>(page, "/api/state");
  expect(videos.map((v) => v.stage)).toEqual(["scheduled", "scheduled", "scheduled"]);
  expect(videos[0].caption?.text).toBe("Three quick tips for beginners\n\n#tips #beginners");
  const times = videos.map((v) => v.schedule!.at);
  expect([...times].sort()).toEqual(times);
});

test("the library shows covers, captions and post times", async ({ page }) => {
  await page.goto("/");
  await clickNode(page, "drop");
  const items = drawer(page).locator(".vitem");
  await expect(items).toHaveCount(3);
  await expect(items.first().locator("img")).toHaveAttribute("src", /\/media\/thumbs\/.+\.jpg/);
  await expect(items.first()).toContainText("#tips #beginners");
  await expect(items.first()).toContainText(/posts \w{3}, \w{3} \d+, \d+:\d{2} (AM|PM)/);
  // The cover image actually loads.
  const loaded = await items.first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});

test("with Running on, a new video goes through on its own", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Paused/ }).click();
  await expect(page.getByRole("button", { name: /Running/ })).toBeVisible();

  await clickNode(page, "drop");
  await drawer(page).locator('input[type="file"]').setInputFiles(fixture("sample.mp4"));
  await expect(drawer(page)).toContainText("Added 1 video.");
  await closeDrawer(page);
  await expect(page.locator(".botlog")).toContainText("Scheduled 4 videos", { timeout: 45_000 });

  await page.getByRole("button", { name: /Running/ }).click();
  await expect(page.getByRole("button", { name: /Paused/ })).toBeVisible();
});

test("Redo sends one video through again and Remove deletes it", async ({ page }) => {
  await page.goto("/");
  await clickNode(page, "drop");
  const last = drawer(page).locator(".vitem").last();
  await expect(last).toContainText("sample.mp4");
  await last.getByRole("button", { name: /Redo/ }).click();
  await expect(page.locator(".botlog")).toContainText("sample.mp4 queued for a cover.");
  await expect(last.locator(".chip").first()).toHaveText("scheduled", { timeout: 45_000 });

  page.once("dialog", (d) => d.accept());
  await last.getByRole("button", { name: "Remove" }).click();
  await expect(drawer(page).locator(".vitem")).toHaveCount(3);
});
