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
  fs.writeFileSync(path.join(here, "record.json"), JSON.stringify({ args: process.argv.slice(2), stdin: input }));
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

function readRecord(): { args: string[]; stdin: string } {
  return JSON.parse(fs.readFileSync(path.join(dir, "record.json"), "utf8"));
}

describe("buildClaudeArgs", () => {
  it("passes the system prompt, model and json schema, and never the prompt or dangerous flags", () => {
    const args = buildClaudeArgs({ system: "be a caption bot" }, { schemaFile: "/tmp/s.json", mcpConfigFile: "/tmp/m.json" }, "claude-opus-5-5");
    expect(args).toContain("-p");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("be a caption bot");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args[args.indexOf("--json-schema") + 1]).toBe("/tmp/s.json");
    // Tool denial, no permission bypass.
    expect(args).toContain("--allowedTools");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--mcp-config");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("omits --model when no model is set", () => {
    const args = buildClaudeArgs({ system: "x" }, { schemaFile: "/s", mcpConfigFile: "/m" }, "");
    expect(args).not.toContain("--model");
  });
});

describe("ClaudeCodeProvider.generateObject", () => {
  it("AC-1: runs `claude -p` and returns the zod-validated object", async () => {
    const provider = new ClaudeCodeProvider("claude-opus-5-5");
    const out = await provider.generateObject({ system: "be a caption bot", prompt: "today I show three tips", schema: Schema });
    expect(out).toEqual({ caption: "Three quick tips", keywords: ["a", "b"] });

    const rec = readRecord();
    expect(rec.args).toContain("-p");
    expect(rec.args[rec.args.indexOf("--system-prompt") + 1]).toBe("be a caption bot");
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

  it("AC-10 robustness: parses JSON the model wrapped in a ```json fence and prose", async () => {
    setMode("fenced");
    const provider = new ClaudeCodeProvider("m");
    const out = await provider.generateObject({ system: "s", prompt: "p", schema: Schema });
    expect(out).toEqual({ caption: "Fenced", keywords: ["x"] });
  });
});
