import { afterEach, describe, expect, it } from "vitest";
import { freshDataDir } from "../../tests/helpers.ts";
import { DEFAULT_SETTINGS, resetSettingsCache } from "../config.ts";

afterEach(() => {
  resetSettingsCache();
});

describe("keyless defaults (AC-6)", () => {
  it("defaults a fresh install to the no-key combo: Claude Code + local Whisper", () => {
    expect(DEFAULT_SETTINGS.llm.provider).toBe("claude-code");
    expect(DEFAULT_SETTINGS.transcription.provider).toBe("local");
  });
});

describe("defaultProviders.llm (AC-7)", () => {
  it("builds a ClaudeCodeProvider when llm.provider is claude-code, with no keys", async () => {
    await freshDataDir();
    const { defaultProviders } = await import("./index.ts");
    const provider = defaultProviders.llm();
    expect(provider.name).toBe("claude-code");
  });
});
