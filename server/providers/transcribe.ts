import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Transcript, Word } from "../../shared/types.ts";
import { MissingKeyError } from "./llm/types.ts";

/** Speech-to-text with word timestamps. Swap providers in Settings -> transcription. */
export interface Transcriber {
  readonly name: string;
  transcribe(audioFile: string, opts: { language?: string }): Promise<Transcript>;
}

interface WhisperJson {
  text: string;
  language?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: { words?: { word: string; start: number; end: number }[] }[];
}

export function wordsFromWhisper(json: WhisperJson): Word[] {
  const raw = json.words?.length ? json.words : (json.segments ?? []).flatMap((s) => s.words ?? []);
  return raw
    .map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }))
    .filter((w) => w.word.length > 0);
}

export class GroqTranscriber implements Transcriber {
  readonly name = "groq";
  constructor(private apiKey: string, private model = "whisper-large-v3") {
    if (!apiKey) throw new MissingKeyError("Groq");
  }

  async transcribe(audioFile: string, opts: { language?: string }): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(audioFile)]), path.basename(audioFile));
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (opts.language && opts.language !== "auto") form.append("language", opts.language);
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcription error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as WhisperJson;
    return { text: json.text.trim(), language: json.language, duration: json.duration, words: wordsFromWhisper(json) };
  }
}

/** Uses the openai-whisper CLI installed on this computer. Slower, free, no key. */
export class LocalWhisperTranscriber implements Transcriber {
  readonly name = "local";
  constructor(private model = "small") {}

  async transcribe(audioFile: string, opts: { language?: string }): Promise<Transcript> {
    const outDir = path.join(path.dirname(audioFile), `whisper-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    const args = [audioFile, "--model", this.model, "--task", "transcribe", "--output_format", "json", "--word_timestamps", "True", "--output_dir", outDir, "--fp16", "False"];
    if (opts.language && opts.language !== "auto") args.push("--language", opts.language);
    await new Promise<void>((resolve, reject) => {
      const p = spawn("whisper", args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => reject(new Error(`Could not start local whisper: ${e.message}`)));
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`whisper exited ${code}: ${err.slice(-500)}`))));
    });
    const file = fs.readdirSync(outDir).find((f) => f.endsWith(".json"));
    if (!file) throw new Error("Local whisper produced no output");
    const json = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8")) as WhisperJson;
    fs.rmSync(outDir, { recursive: true, force: true });
    return { text: json.text.trim(), language: json.language, words: wordsFromWhisper(json) };
  }
}
