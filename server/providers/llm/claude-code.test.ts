import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { buildClaudeArgs, ClaudeCodeProvider, resetClaudeCommandCache } from "./claude-code.ts";

// A fake `claude` executable (a Node script). It records the argv and stdin it received,
// then behaves according to a sibling `mode.txt` so we can exercise every branch without a
// real CLI or model call. It reads config from files (not env) because the provider
// deliberately strips its environment before spawning.
const FAKE = `
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(process.argv[1]);
const read = (f, d) => { try { return fs.readFileSync(path.join(here, f), "utf8"); } catch { return d; } };
const mode = read("mode.txt", "ok").trim();
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const at = (flag) => args[args.indexOf(flag) + 1];
  const systemFile = args.includes("--system-prompt-file") ? at("--system-prompt-file") : null;
  const system = systemFile && fs.existsSync(systemFile) ? fs.readFileSync(systemFile, "utf8") : null;
  fs.writeFileSync(path.join(here, "record.json"), JSON.stringify({ args, stdin: input, system }));
  // Mirror the real CLI: --json-schema takes JSON text, not a file path.
  if (args.includes("--json-schema")) {
    let schema;
    try { schema = JSON.parse(at("--json-schema")); } catch {
      process.stderr.write("Error: --json-schema is not valid JSON\\n");
      process.exit(1);
    }
    // Real CLI quirk: a schema with a "$schema" key is silently ignored and the model answers in prose.
    if (schema && schema.$schema) {
      process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "**Here's a caption** for you! #tips" }));
      process.exit(0);
    }
  }
  if (systemFile && system === null) {
    process.stderr.write("Error: system prompt file not found\\n");
    process.exit(1);
  }
  if (mode === "old-cli") {
    // Real CLI output when the model needs a newer version: JSON on stdout, exit code 1.
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 400, result: "API Error: 400 Claude Code 2.1.201 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again." }));
    process.exit(1);
  }
  if (mode === "rate-limited") {
    process.stdout.write(JSON.stringify({ type: "result", is_error: true, api_error_status: 429, result: "API Error: 429 You've hit your usage limit. Resets at 5pm." }));
    process.exit(0);
  }
  if (mode === "structured") {
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "Done.", structured_output: { caption: "From structured", keywords: ["s"] } }));
    process.exit(0);
  }
  if (mode === "not-signed-in") {
    process.stderr.write("Invalid API key · Please run /login to sign in\\n");
    process.exit(1);
  }
  if (mode === "bad-json") {
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "this is not json {" }));
    process.exit(0);
  }
  if (mode === "schema-violation") {
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify({ wrong: 1 }) }));
    process.exit(0);
  }
  if (mode === "fenced") {
    const inner = JSON.stringify({ caption: "Fenced", keywords: ["x"] });
    process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "Here you go:\\n\`\`\`json\\n" + inner + "\\n\`\`\`" }));
    process.exit(0);
  }
  if (mode === "slow") {
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify({ caption: "late", keywords: [] }) }));
      process.exit(0);
    }, 3000);
    return;
  }
  const result = JSON.stringify({ caption: "Three quick tips", keywords: ["a", "b"] });
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result }));
  process.exit(0);
});
`;

const Schema = z.object({ caption: z.string(), keywords: z.array(z.string()) });

let dir: string;
let fakePath: string;

function setMode(mode: string): void {
  fs.writeFileSync(path.join(dir, "mode.txt"), mode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-test-"));
  fakePath = path.join(dir, "fake-claude.mjs");
  fs.writeFileSync(fakePath, FAKE);
  setMode("ok");
  process.env.CLAUDE_CODE_PATH = fakePath;
  resetClaudeCommandCache();
});

afterEach(() => {
  delete process.env.CLAUDE_CODE_PATH;
  resetClaudeCommandCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function readRecord(): { args: string[]; stdin: string; system: string | null } {
  return JSON.parse(fs.readFileSync(path.join(dir, "record.json"), "utf8"));
}

const SCHEMA_JSON = JSON.stringify({ type: "object", properties: { a: { type: "string" } } });

describe("buildClaudeArgs", () => {
  it("passes the system prompt file, model and inline json schema, and never the prompt or dangerous flags", () => {
    const args = buildClaudeArgs({ effort: "high" }, { schemaJson: SCHEMA_JSON, systemFile: "/tmp/system.md", mcpConfigFile: "/tmp/m.json" }, "claude-opus-5-5");
    expect(args).toContain("-p");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args[args.indexOf("--system-prompt-file") + 1]).toBe("/tmp/system.md");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
    // The real CLI wants the schema itself as JSON text, not a path.
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual(JSON.parse(SCHEMA_JSON));
    // No tools at all, no personal settings/hooks/CLAUDE.md, no saved sessions, no permission bypass.
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("omits --model and --effort when not set", () => {
    const args = buildClaudeArgs({}, { schemaJson: SCHEMA_JSON, systemFile: "/s", mcpConfigFile: "/m" }, "");
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--effort");
  });
});

describe("ClaudeCodeProvider.generateObject", () => {
  it("AC-1: runs `claude -p` and returns the zod-validated object", async () => {
    const provider = new ClaudeCodeProvider("claude-opus-5-5");
    const out = await provider.generateObject({ system: "be a caption bot", prompt: "today I show three tips", schema: Schema });
    expect(out).toEqual({ caption: "Three quick tips", keywords: ["a", "b"] });

    const rec = readRecord();
    expect(rec.args).toContain("-p");
    // The system prompt travels in a file (Windows caps command lines at ~32K chars).
    expect(rec.system).toBe("be a caption bot");
    expect(rec.args).not.toContain("be a caption bot");
    expect(rec.args[rec.args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(rec.args).toContain("--json-schema");
    // The prompt must not leak onto the command line.
    expect(rec.args).not.toContain("today I show three tips");
  });

  it("AC-2: sends a long prompt over stdin, not as an argument", async () => {
    const transcript = "word ".repeat(5000).trim();
    const provider = new ClaudeCodeProvider("m");
    await provider.generateObject({ system: "s", prompt: transcript, schema: Schema });
    const rec = readRecord();
    expect(rec.stdin).toBe(transcript);
    expect(rec.args.some((a) => a.includes("word word"))).toBe(false);
  });

  it("AC-2: aborts with a timeout error when the CLI runs too long", async () => {
    setMode("slow");
    const provider = new ClaudeCodeProvider("m", 200);
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/timed out/i);
  });

  it("AC-3: throws a clear not-found error when the CLI is missing", async () => {
    process.env.CLAUDE_CODE_PATH = path.join(dir, "does-not-exist.mjs");
    resetClaudeCommandCache();
    const provider = new ClaudeCodeProvider("m");
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/not found/i);
  });

  it("AC-4: throws an actionable not-signed-in error", async () => {
    setMode("not-signed-in");
    const provider = new ClaudeCodeProvider("m");
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/sign in/i);
  });

  it("AC-5: throws on output that is not valid JSON and returns no object", async () => {
    setMode("bad-json");
    const provider = new ClaudeCodeProvider("m");
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/not valid json/i);
  });

  it("AC-5: throws when the output does not satisfy the schema", async () => {
    setMode("schema-violation");
    const provider = new ClaudeCodeProvider("m");
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow();
  });

  it("passes the CLI's own error message through instead of a vague one", async () => {
    setMode("old-cli");
    const provider = new ClaudeCodeProvider("m");
    const err = await provider.generateObject({ system: "s", prompt: "p", schema: Schema }).catch((e: Error) => e);
    expect(String(err)).toMatch(/does not support this model.*claude update/);
    expect(String(err)).not.toMatch(/not signed in|exited with code/);
  });

  it("explains usage limits", async () => {
    setMode("rate-limited");
    const provider = new ClaudeCodeProvider("m");
    await expect(provider.generateObject({ system: "s", prompt: "p", schema: Schema })).rejects.toThrow(/usage limit/);
  });

  it("prefers the CLI's structured_output over the result text", async () => {
    setMode("structured");
    const provider = new ClaudeCodeProvider("m");
    const out = await provider.generateObject({ system: "s", prompt: "p", schema: Schema });
    expect(out).toEqual({ caption: "From structured", keywords: ["s"] });
  });

  it("handles a system prompt longer than a Windows command line allows", async () => {
    const system = "rule ".repeat(10_000);
    const provider = new ClaudeCodeProvider("m");
    await provider.generateObject({ system, prompt: "p", schema: Schema });
    expect(readRecord().system).toBe(system);
  });

  it("AC-10 robustness: parses JSON the model wrapped in a ```json fence and prose", async () => {
    setMode("fenced");
    const provider = new ClaudeCodeProvider("m");
    const out = await provider.generateObject({ system: "s", prompt: "p", schema: Schema });
    expect(out).toEqual({ caption: "Fenced", keywords: ["x"] });
  });
});
