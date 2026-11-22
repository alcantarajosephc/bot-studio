import { apiKey, getSettings } from "../config.ts";
import { ClaudeProvider } from "./llm/claude.ts";
import { GroqLlmProvider } from "./llm/groq.ts";
import type { LlmProvider } from "./llm/types.ts";
import { GroqTranscriber, LocalWhisperTranscriber, type Transcriber } from "./transcribe.ts";

export interface Providers {
  llm: () => LlmProvider;
  transcriber: () => Transcriber;
}

/** Real providers, built from current Settings each time (so key changes apply right away). */
export const defaultProviders: Providers = {
  llm() {
    const s = getSettings().llm;
    return s.provider === "groq"
      ? new GroqLlmProvider(apiKey("groq"), s.groqModel)
      : new ClaudeProvider(apiKey("anthropic"), s.claudeModel);
  },
  transcriber() {
    const s = getSettings().transcription;
    return s.provider === "local" ? new LocalWhisperTranscriber(s.localModel) : new GroqTranscriber(apiKey("groq"), s.groqModel);
  },
};

export type { LlmProvider, Transcriber };
