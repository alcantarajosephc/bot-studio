import { expect, test } from "@playwright/test";
import { clickNode, closeDrawer, drawer, fixture } from "./helpers";

test("the office draws the room and every bot", async ({ page }) => {
  await page.goto("/#office");
  const canvas = page.locator(".office > canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".office-legend .who")).toHaveCount(7);

  // Something real was drawn: lots of different colors, not a blank canvas.
  await page.waitForTimeout(500);
  const colors = await canvas.evaluate((c: HTMLCanvasElement) => {
    const g = c.getContext("2d")!;
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });
  expect(colors).toBeGreaterThan(20);
});

test("it keeps animating", async ({ page }) => {
  await page.goto("/#office");
  const canvas = page.locator(".office > canvas");
  const snap = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const a = await snap();
  await expect.poll(snap, { timeout: 10_000 }).not.toBe(a);
});

test("clicking a bot in the legend or on the canvas opens its panel", async ({ page }) => {
  await page.goto("/#office");
  await page.locator(".office-legend .who", { hasText: "Scheduler Bot" }).click();
  await expect(drawer(page)).toContainText("Scheduler Bot");
  await page.keyboard.press("Escape");

  // Posting Bot never leaves its desk (it's not connected), so its spot on the canvas is stable.
  const canvas = page.locator(".office > canvas");
  const box = (await canvas.boundingBox())!;
  const hit = await canvas.evaluate((c: HTMLCanvasElement) => {
    // Desk (1, 5.4) + seat offset (1, 1.35) in tile space -> screen point, matching Office.tsx.
    const S = 3, TW = 24, TH = 12, OX = 420 / 2 + 6, OY = 58;
    const x = 2, y = 6.75;
    const sx = OX + ((x - y) * TW) / 2, sy = OY + ((x + y) * TH) / 2 - 9;
    const r = c.getBoundingClientRect();
    return { x: (sx * S * r.width) / c.width, y: (sy * S * r.height) / c.height };
  });
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  await expect(drawer(page)).toContainText("Posting Bot");
});

test("a hand-off reel and the batch celebration actually draw", async ({ page }) => {
  // Pause so the new video waits while we get the office on screen, then run it
  // with the office mounted so the hand-off + celebration animate where we can see them.
  await page.goto("/");
  await (await page.request.post("/api/running", { data: { running: false } })).json();

  await clickNode(page, "drop");
  await drawer(page).locator('input[type="file"]').setInputFiles(fixture("sample.mp4"));
  await expect(drawer(page)).toContainText("Added 1 video.");
  await closeDrawer(page);

  await page.goto("/#office");
  const canvas = page.locator(".office > canvas");
  await expect(canvas).toBeVisible();
  // Let the animation loop record a baseline (bots start idle) before work begins.
  await page.waitForTimeout(400);

  // Start a real batch: the new video advances through the bots, which drives the
  // hand-off reels, and the scheduled counter ticks up, which fires the celebration.
  await page.request.post("/api/run");

  const fx = (attr: string) => canvas.evaluate((c: HTMLCanvasElement, a: string) => Number(c.dataset[a] ?? 0), attr);
  await expect.poll(() => fx("fxHandoffs"), { timeout: 45_000 }).toBeGreaterThan(0);
  await expect.poll(() => fx("fxCelebrations"), { timeout: 45_000 }).toBeGreaterThan(0);
});
