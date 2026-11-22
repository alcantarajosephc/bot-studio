import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { GenerateObjectOptions, LlmProvider } from "./types.ts";
import { MissingKeyError } from "./types.ts";

export class ClaudeProvider implements LlmProvider {
  readonly name = "claude";
  private client: Anthropic;

  constructor(apiKey: string, private model = "claude-opus-5-5") {
    if (!apiKey) throw new MissingKeyError("Anthropic");
    this.client = new Anthropic({ apiKey });
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<T> {
    // Streaming avoids HTTP timeouts on long edit plans.
    // Server-side fallbacks: if the model declines, the API retries on a fallback model in the same call.
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: {
        effort: opts.effort ?? "medium",
        format: betaZodOutputFormat(opts.schema as never),
      },
      messages: [{ role: "user", content: opts.prompt }],
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude declined this request (${response.stop_details?.category ?? "no category"}).`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("Claude ran out of output tokens before finishing.");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return opts.schema.parse(JSON.parse(text));
  }
}
