import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const fixture = (name: string) => path.join(import.meta.dirname, ".fixtures", name);

export async function openTab(page: Page, label: string) {
  await page.locator(".tabs").getByRole("button", { name: label, exact: true }).click();
}

/** Click a node on the canvas by its id (drop, thumbnail, caption, scheduler, posting, manager, editor, revision). */
export async function clickNode(page: Page, id: string) {
  await page.locator(`.react-flow__node[data-id="${id}"] .node-head`).click();
}

export const drawer = (page: Page) => page.getByRole("dialog");

export async function closeDrawer(page: Page) {
  await drawer(page).getByRole("button", { name: "✕" }).first().click();
  await expect(drawer(page)).toHaveCount(0);
}

export async function api<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as T;
}
