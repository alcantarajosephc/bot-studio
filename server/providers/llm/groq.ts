import { z } from "zod";
import type { GenerateObjectOptions, LlmProvider } from "./types.ts";
import { MissingKeyError } from "./types.ts";

/** Groq chat models (OpenAI-style endpoint). Kept so captions can move to Groq with one setting. */
export class GroqLlmProvider implements LlmProvider {
  readonly name = "groq";

  constructor(private apiKey: string, private model = "llama-3.3-70b-versatile") {
    if (!apiKey) throw new MissingKeyError("Groq");
  }

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<T> {
    const schemaJson = JSON.stringify(z.toJSONSchema(opts.schema));
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: Math.min(opts.maxTokens ?? 8000, 8000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${opts.system}\n\nReply with only a JSON object matching this JSON Schema:\n${schemaJson}` },
          { role: "user", content: opts.prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    return opts.schema.parse(JSON.parse(body.choices[0].message.content));
  }
}
