import { describe, expect, it } from "vitest";
import { setupProblem } from "../app/src/lib/setup.ts";
import { DEFAULT_SETTINGS, publicSettings } from "../server/config.ts";
import type { PublicSettings } from "../shared/types.ts";

const base = (): PublicSettings => ({ ...publicSettings(DEFAULT_SETTINGS), keys: { anthropic: false, groq: false } });

describe("setupProblem", () => {
  it("is happy with the keyless default", () => {
    expect(setupProblem(base())).toBeNull();
  });
  it("asks for an Anthropic key only when the writing model is Claude", () => {
    const s = base();
    s.llm.provider = "claude";
    expect(setupProblem(s)).toMatch(/Anthropic API key/);
    expect(setupProblem(s)).not.toMatch(/Groq/);
    s.keys.anthropic = true;
    expect(setupProblem(s)).toBeNull();
  });
  it("asks for a Groq key when Groq does the listening or writing", () => {
    const s = base();
    s.transcription.provider = "groq";
    expect(setupProblem(s)).toMatch(/Groq API key \(used for listening\)/);
    s.llm.provider = "groq";
    expect(setupProblem(s)).toMatch(/writing and listening/);
  });
});
