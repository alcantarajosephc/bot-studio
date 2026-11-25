import { expect, test } from "@playwright/test";
import type { PublicSettings } from "../shared/types";
import { api } from "./helpers";

test.describe.configure({ mode: "serial" });

const FAKE_KEY = "gsk_e2e_not_a_real_key_123";

test("fresh install defaults to the keyless combo with no key warnings", async ({ page }) => {
  await page.goto("/#settings");
  // Claude Code is the default writing model, local Whisper the default listening model.
  await expect(page.getByLabel("Writing model")).toHaveValue("claude-code");
  await expect(page.locator("label.field", { hasText: /^Listening/ }).locator("select")).toHaveValue("local");
  // The Claude Code status row is shown (CLI is faked as signed in for the e2e server).
  await expect(page.getByText(/Claude Code: ✓ signed in/)).toBeVisible();
  // No red "missing" key warnings for the keyless combo, and no needs-attention dot.
  await expect(page.getByText("missing")).toHaveCount(0);
  await expect(page.locator(".dot-warn")).toHaveCount(0);
});

test("switching the writing model brings back the relevant key warning", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByLabel("Writing model").selectOption("claude");
  await expect(page.getByText(/Anthropic API key.*missing/)).toBeVisible();
  // The Claude Code status row is only shown for the keyless writing model.
  await expect(page.getByText(/Claude Code: /)).toHaveCount(0);

  await page.getByLabel("Writing model").selectOption("groq");
  await expect(page.getByText(/Groq API key.*missing/)).toBeVisible();

  // Listening = Groq Whisper also needs a Groq key.
  await page.getByLabel("Writing model").selectOption("claude-code");
  await page.locator("label.field", { hasText: /^Listening/ }).locator("select").selectOption("groq");
  await expect(page.getByText(/Groq API key.*missing/)).toBeVisible();
  await expect(page.getByText(/Claude Code: ✓ signed in/)).toBeVisible();
});

test("keys save without ever coming back to the browser", async ({ page }) => {
  await page.goto("/#settings");
  const groq = page.getByLabel(/Groq API key/);
  await groq.fill(FAKE_KEY);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved on this computer.")).toBeVisible();
  await expect(page.getByText(/Groq API key.*✓ saved/)).toBeVisible();
  await expect(groq).toHaveValue("");

  await page.reload();
  await expect(page.getByText(/Groq API key.*✓ saved/)).toBeVisible();
  expect(await page.content()).not.toContain(FAKE_KEY);
  const raw = await (await page.request.get("/api/state")).text();
  expect(raw).not.toContain(FAKE_KEY);
});

test("model and listening choices save", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByLabel("Writing model").selectOption("groq");
  await page.getByLabel("Groq model").fill("llama-test");
  await page.getByLabel("Spoken language").selectOption("tl");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved on this computer.")).toBeVisible();
  const s = await api<PublicSettings>(page, "/api/settings");
  expect(s.llm).toMatchObject({ provider: "groq", groqModel: "llama-test" });
  expect(s.transcription.language).toBe("tl");
});

test("a key can be removed", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByRole("button", { name: "Remove Groq key" }).click();
  await expect(page.getByText(/Groq API key.*missing/)).toBeVisible();
  const s = await api<PublicSettings>(page, "/api/settings");
  expect(s.keys.groq).toBe(false);
});
