import type { z } from "zod";

export interface GenerateObjectOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** "low" | "medium" | "high". Providers that don't support it ignore it. */
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/**
 * Every bot talks to a model through this one interface.
 * To switch models, add a provider file and change Settings -> llm.provider.
 */
export interface LlmProvider {
  readonly name: string;
  generateObject<T>(opts: GenerateObjectOptions<T>): Promise<T>;
}

export class MissingKeyError extends Error {
  constructor(what: string) {
    super(`${what} API key is missing. Add it in Settings.`);
  }
}
