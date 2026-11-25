import type { PublicSettings } from "../../../shared/types";

/**
 * What's missing for the setup the user picked, in plain words, or null when nothing is.
 * Keys are only needed for the providers that use them: the default (Claude Code + local Whisper) needs none.
 */
export function setupProblem(s: PublicSettings | null | undefined): string | null {
  if (!s) return null;
  const missing: string[] = [];
  if (s.llm.provider === "claude" && !s.keys.anthropic) missing.push("an Anthropic API key (Writing model is set to Claude)");
  const groqFor: string[] = [];
  if (s.llm.provider === "groq") groqFor.push("writing");
  if (s.transcription.provider === "groq") groqFor.push("listening");
  if (groqFor.length && !s.keys.groq) missing.push(`a Groq API key (used for ${groqFor.join(" and ")})`);
  if (!missing.length) return null;
  return `Your current setup needs ${missing.join(" and ")}. Add it under Keys & models, or switch back to Claude Code and local Whisper, which need no keys.`;
}
