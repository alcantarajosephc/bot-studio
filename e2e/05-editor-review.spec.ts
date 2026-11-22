import { expect, test } from "@playwright/test";
import type { EditorProject } from "../shared/types";
import { api, fixture, openTab } from "./helpers";

test.describe.configure({ mode: "serial" });
// Rendering real video takes a while.
test.setTimeout(240_000);

test("upload a raw video, get v1, leave a note in Review, revise into v2", async ({ page }) => {
  await page.goto("/#editor");
  await expect(page.getByRole("heading", { name: "Video Editor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit it" })).toBeDisabled();

  await page.getByLabel("Name").fill("E2E edit");
  await page.getByLabel("Raw video (talking head)").setInputFiles(fixture("raw-talk.mp4"));
  await page.getByLabel("Screenshots / B-roll (optional)").setInputFiles(fixture("screenshot.png"));
  await page.getByRole("button", { name: "Edit it" }).click();

  // Project appears and works through planning -> rendering -> ready.
  await expect(page.locator(".pitem", { hasText: "E2E edit" })).toBeVisible();
  await expect(page.locator(".chips a", { hasText: "screenshot.png" })).toBeVisible();
  const v1 = page.locator(".version", { has: page.locator(".vtag", { hasText: "v1" }) });
  await expect(v1).toContainText("Ready", { timeout: 180_000 });
  await expect(v1).toContainText("1 cuts · 1 yellow words · 1 callouts · 1 inserts · 0 zooms · 0 title cards");
  await expect(v1.locator("video")).toHaveAttribute("src", /\/media\/editor\/.+\/v1\.mp4/);
  await expect(v1.getByRole("link", { name: "Download" })).toBeVisible();
  const duration = await v1.locator("video").evaluate(
    (v: HTMLVideoElement) => new Promise<number>((r) => (v.readyState >= 1 ? r(v.duration) : v.addEventListener("loadedmetadata", () => r(v.duration)))),
  );
  expect(duration).toBeGreaterThan(1);
  expect(duration).toBeLessThan(6); // pauses and the "um" were cut from the 6s source

  // Review: click the video at a moment, write a note.
  await page.getByRole("button", { name: "Open in Review" }).click();
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
  const video = page.locator(".review-player video");
  await video.evaluate((v: HTMLVideoElement) => new Promise<void>((r) => {
    const go = () => { v.currentTime = 1.5; v.addEventListener("seeked", () => r(), { once: true }); };
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }));
  await video.click();
  const input = page.locator(".review-notes input");
  await expect(input).toHaveAttribute("placeholder", /Note at 0:01\.5/);
  await input.fill("zoom in on this part");
  await page.getByRole("button", { name: "Add note" }).click();
  const note = page.locator(".note", { hasText: "zoom in on this part" });
  await expect(note).toBeVisible();
  await expect(note.locator(".stamp")).toHaveText("0:01.5");
  await expect(page.locator(".review-bar .marker")).toHaveCount(1);

  // Clicking the timestamp jumps the video there.
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 0));
  await note.locator(".stamp").click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 10) / 10)).toBe(1.5);

  // Copy notes puts them on the clipboard in the format the editor reads.
  await page.getByRole("button", { name: "Copy notes" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe("0:01.5 zoom in on this part");

  // Paste into the editor and make v2.
  await openTab(page, "Video editor");
  await page.getByPlaceholder("0:12.0 make the caption bigger here").fill(copied);
  await page.getByRole("button", { name: "Make the next version" }).click();
  const v2 = page.locator(".version", { has: page.locator(".vtag", { hasText: "v2" }) });
  await expect(v2).toContainText("Notes: 0:01.5 zoom in on this part");
  await expect(v2).toContainText("Ready", { timeout: 180_000 });
  await expect(v2).toContainText("1 zooms");

  // The note on v1 is now marked done, and Review offers both versions.
  await openTab(page, "Review");
  await expect(page.locator(".review-top select").nth(1).locator("option")).toHaveText(["v1", "v2"]);
  await page.locator(".review-top select").nth(1).selectOption("1");
  await expect(page.locator(".note", { hasText: "zoom in on this part" }).getByRole("button", { name: "done" })).toBeVisible();

  const projects = (await api<{ projects: EditorProject[] }>(page, "/api/state")).projects;
  expect(projects[0].versions.map((v) => v.status)).toEqual(["done", "done"]);
});

test("notes can be toggled and deleted", async ({ page }) => {
  await page.goto("/#review");
  await page.locator(".review-top select").nth(1).selectOption("1");
  const note = page.locator(".note", { hasText: "zoom in on this part" });
  await note.getByRole("button", { name: "done" }).click();
  await expect(note.getByRole("button", { name: "to do" })).toBeVisible();
  await note.getByRole("button", { name: "delete" }).click();
  await expect(page.locator(".note")).toHaveCount(0);
});

test("revising needs notes, and a project can be deleted", async ({ page }) => {
  await page.goto("/#editor");
  await expect(page.getByRole("button", { name: "Make the next version" })).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".pitem")).toHaveCount(0);
  await expect(page.getByText("No edits yet.")).toBeVisible();
});
