import { expect, test } from "@playwright/test";
import { clickNode, closeDrawer, drawer, openTab } from "./helpers";

const NODES = ["drop", "thumbnail", "caption", "output", "scheduler", "posting", "manager", "editor", "revision"];
const BOTS = ["Bot Manager", "Thumbnail Bot", "SEO Caption Bot", "Scheduler Bot", "Posting Bot", "Video Editor", "Review Bot"];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("loads the app with every bot on the canvas", async ({ page }) => {
  await expect(page).toHaveTitle("Bot Studio");
  await expect(page.locator(".brand")).toContainText("Bot Studio");
  await expect(page.locator(".conn.ok")).toBeVisible();
  for (const id of NODES) await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  const rows = page.locator(".statusrow .name");
  await expect(rows).toHaveText(BOTS);
  await expect(page.locator(".statusrow", { hasText: "Posting Bot" })).toContainText("not connected");
  await expect(page.locator(".botlog")).toContainText("No activity yet");
});

test("every tab renders its page", async ({ page }) => {
  const pages: [string, string][] = [
    ["Office view", "office"],
    ["Video editor", "Video Editor"],
    ["Review", "Review"],
    ["How to use", "How to use"],
    ["Setup guide", "Setup guide"],
    ["Keys & models", "Keys & models"],
  ];
  for (const [tab, heading] of pages) {
    await openTab(page, tab);
    if (heading === "office") await expect(page.locator(".office > canvas")).toBeVisible();
    else await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await openTab(page, "Canvas");
  await expect(page.locator(".react-flow")).toBeVisible();
});

test("tab URLs survive a reload", async ({ page }) => {
  await page.goto("/#settings");
  await expect(page.getByRole("heading", { name: "Keys & models" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Keys & models" })).toBeVisible();
});

test("clicking a node opens its panel; Escape, ✕ and changing tabs close it", async ({ page }) => {
  await clickNode(page, "scheduler");
  await expect(drawer(page)).toContainText("Scheduler Bot");
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);

  await clickNode(page, "caption");
  await expect(drawer(page)).toContainText("SEO Caption Bot");
  await closeDrawer(page);

  await clickNode(page, "thumbnail");
  await expect(drawer(page)).toBeVisible();
  await page.locator(".drawer-backdrop").click({ position: { x: 20, y: 300 } });
  await expect(drawer(page)).toHaveCount(0);

  await page.locator(".statusrow", { hasText: "Posting Bot" }).click();
  await expect(drawer(page)).toContainText("Posting Bot");
  await page.goto("/#office");
  await expect(drawer(page)).toHaveCount(0);
});

test("the editor and review nodes jump to their pages", async ({ page }) => {
  await clickNode(page, "editor");
  await expect(page.getByRole("heading", { name: "Video Editor" })).toBeVisible();
  await openTab(page, "Canvas");
  await clickNode(page, "revision");
  await expect(page.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
});

test("Tidy up puts moved nodes back", async ({ page }) => {
  const node = page.locator('.react-flow__node[data-id="scheduler"]');
  const before = await node.boundingBox();
  await node.hover();
  await page.mouse.down();
  // hover() grabs the node's center, so move relative to the center.
  await page.mouse.move(before!.x + before!.width / 2 + 150, before!.y + before!.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const moved = await node.boundingBox();
  expect(Math.abs(moved!.x - before!.x)).toBeGreaterThan(50);
  await page.getByRole("button", { name: /Tidy up/ }).click();
  await expect.poll(async () => Math.round((await node.boundingBox())!.x)).toBe(Math.round(before!.x));
});
