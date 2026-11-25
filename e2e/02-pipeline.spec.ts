import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import type { PublicSettings, VideoRecord } from "../shared/types";
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

test("Run everything takes every video to the output folder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Run everything/ }).click();

  const log = page.locator(".botlog");
  await expect(log).toContainText("Running everything: 3 videos.");
  await expect(log).toContainText(/clip1\.mp4: cover taken from 0:0\d \(clearest, best-exposed frame\)/);
  await expect(log).toContainText("Transcribed clip1.mp4.");
  await expect(log).toContainText("Caption ready for clip1.mp4: quick tips, beginner tips");
  await expect(log).toContainText("Saved clip3 (video, cover, caption)", { timeout: 45_000 });
  // Scheduling is off by default: no posting times, no posting.
  await expect(log).not.toContainText("Scheduled");

  // Canvas nodes show the results.
  await expect(page.locator('.react-flow__node[data-id="thumbnail"] .thumbs img')).toHaveCount(3);
  await expect(page.locator('.react-flow__node[data-id="caption"] .chip-yellow')).toHaveText(["quick tips", "beginner tips"]);
  await expect(page.locator('.react-flow__node[data-id="output"]')).toContainText("3 saved");
  await expect(page.locator('.react-flow__node[data-id="drop"] .chip-green')).toHaveCount(3);
  await expect(page.locator(".statusrow", { hasText: "Scheduler Bot" }).locator(".pill").last()).toHaveText("off");
  for (const name of ["Bot Manager", "Thumbnail Bot", "SEO Caption Bot"]) {
    await expect(page.locator(".statusrow", { hasText: name }).locator(".pill").last()).toHaveText("idle");
  }

  // The files are really there: video, cover and caption for each.
  const { outputDir } = await api<PublicSettings>(page, "/api/settings");
  expect(fs.readdirSync(outputDir).sort()).toEqual([
    "clip1.jpg", "clip1.mp4", "clip1.txt", "clip2.jpg", "clip2.mp4", "clip2.txt", "clip3.jpg", "clip3.mp4", "clip3.txt",
  ]);
  expect(fs.readFileSync(path.join(outputDir, "clip1.txt"), "utf8")).toBe("Three quick tips for beginners\n\n#tips #beginners\n");

  const { videos } = await api<{ videos: VideoRecord[] }>(page, "/api/state");
  expect(videos.map((v) => v.stage)).toEqual(["done", "done", "done"]);
  expect(videos.every((v) => !v.schedule)).toBe(true);
});

test("the library shows covers, captions and saved file names", async ({ page }) => {
  await page.goto("/");
  await clickNode(page, "drop");
  const items = drawer(page).locator(".vitem");
  await expect(items).toHaveCount(3);
  await expect(items.first().locator("img")).toHaveAttribute("src", /\/media\/thumbs\/.+\.jpg/);
  await expect(items.first()).toContainText("#tips #beginners");
  await expect(items.first()).toContainText("saved as clip1");
  await expect(items.first().locator(".chip").first()).toHaveText("saved");
  // The cover image actually loads.
  const loaded = await items.first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});

test("the Output folder node opens a panel listing the saved files", async ({ page }) => {
  await page.goto("/");
  await clickNode(page, "output");
  const d = drawer(page);
  await expect(d).toContainText("Output folder");
  const { outputDir } = await api<PublicSettings>(page, "/api/settings");
  await expect(d.locator("code").first()).toHaveText(outputDir);
  await expect(d).toContainText("Saved videos (3)");
  await expect(d).toContainText("clip2.mp4 · clip2.jpg · clip2.txt");
});

test("with Running on, a new video goes through on its own", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Paused/ }).click();
  await expect(page.getByRole("button", { name: /Running/ })).toBeVisible();

  await clickNode(page, "drop");
  await drawer(page).locator('input[type="file"]').setInputFiles(fixture("sample.mp4"));
  await expect(drawer(page)).toContainText("Added 1 video.");
  await closeDrawer(page);
  await expect(page.locator(".botlog")).toContainText("Saved sample (video, cover, caption)", { timeout: 45_000 });

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
  await expect(last.locator(".chip").first()).toHaveText("saved", { timeout: 45_000 });
  // Redo replaces its own files instead of adding "sample (2)".
  const { outputDir } = await api<PublicSettings>(page, "/api/settings");
  expect(fs.readdirSync(outputDir).filter((f) => f.startsWith("sample"))).toHaveLength(3);

  page.once("dialog", (d) => d.accept());
  await last.getByRole("button", { name: "Remove" }).click();
  await expect(drawer(page).locator(".vitem")).toHaveCount(3);
});
