import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ClaudeCodeStatus } from "../../../shared/types.ts";
import type { GenerateObjectOptions, LlmProvider } from "./types.ts";

/**
 * Keyless writing model: drives the Claude Code CLI (`claude -p`) in headless mode,
 * so captions and edit plans run against the user's Claude login instead of an API key.
 *
 * Security: the executable is resolved from the environment only (never from Settings),
 * the untrusted prompt/transcript goes over stdin (never the command line), tools are
 * denied, API-key env vars are stripped, and the child runs in a throwaway empty folder.
 */

/** How we invoke the CLI: either the binary directly, or `node cli.js` on Windows/for .js overrides. */
interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
}

let resolvedCache: ResolvedCommand | null | undefined;

/** Error text we surface when the CLI can't be found, used for both the check and the provider. */
const NOT_FOUND_MESSAGE =
  "Claude Code CLI not found. Install it and run `claude` once to sign in, or set CLAUDE_CODE_PATH to its location.";
const NOT_SIGNED_IN_MESSAGE = "Claude Code CLI is not signed in. Run `claude` once in a terminal and sign in.";

/**
 * Resolve the Claude Code executable. Only trusts the CLAUDE_CODE_PATH env var or the
 * fixed binary name `claude` on PATH — never anything web-settable. Cached so the status
 * route can't spawn a resolver on every request.
 */
export function resolveClaudeCommand(): ResolvedCommand | null {
  if (resolvedCache !== undefined) return resolvedCache;
  resolvedCache = computeClaudeCommand();
  return resolvedCache;
}

/** Forget the cached resolution (tests switch CLAUDE_CODE_PATH between cases). */
export function resetClaudeCommandCache(): void {
  resolvedCache = undefined;
}

function computeClaudeCommand(): ResolvedCommand | null {
  const override = process.env.CLAUDE_CODE_PATH?.trim();
  if (override) {
    if (!fs.existsSync(override)) return null;
    // A .js/.mjs/.cjs entry point (or the CLI's cli.js) must be run through node.
    if (/\.(c|m)?js$/i.test(override)) return { command: process.execPath, prefixArgs: [override] };
    // On Windows a .cmd/.ps1 shim can't be spawned with shell:false; dig out the cli.js it points at.
    if (process.platform === "win32" && /\.(cmd|ps1|bat)$/i.test(override)) {
      const cli = cliFromShim(override);
      if (cli) return { command: process.execPath, prefixArgs: [cli] };
      return null;
    }
    return { command: override, prefixArgs: [] };
  }

  const found = whichClaude();
  if (!found) return null;
  if (process.platform === "win32" && /\.(cmd|ps1|bat)$/i.test(found)) {
    const cli = cliFromShim(found);
    if (cli) return { command: process.execPath, prefixArgs: [cli] };
    // Shim format we don't recognise: better to report not-found than to spawn a shell.
    return null;
  }
  return { command: found, prefixArgs: [] };
}

/** Locate `claude` on PATH without a shell. Returns the first existing match. */
function whichClaude(): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude.bat", "claude.ps1", "claude"] : ["claude"];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/** Parse an npm-style .cmd/.ps1 shim to find the cli.js it launches. Shim formats vary, so match loosely. */
function cliFromShim(shimPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const match = text.match(/([^\s"']+?cli\.(?:c|m)?js)/i);
  if (!match) return null;
  let ref = match[1].replace(/%~dp0\\?/gi, "").replace(/\$PSScriptRoot[\\/]?/gi, "");
  ref = ref.replace(/\\/g, path.sep);
  const resolved = path.isAbsolute(ref) ? ref : path.resolve(path.dirname(shimPath), ref);
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * The argv for `claude -p`, excluding the resolver prefix. Pure and exported so it can be
 * asserted in tests. The prompt is NOT here — it goes over stdin.
 */
export function buildClaudeArgs(
  opts: Pick<GenerateObjectOptions<unknown>, "system">,
  files: { schemaFile: string; mcpConfigFile: string },
  model: string,
): string[] {
  const args = ["-p", "--output-format", "json", "--system-prompt", opts.system];
  if (model.trim()) args.push("--model", model.trim());
  args.push("--json-schema", files.schemaFile);
  // Deny all tools: this call only needs text in, JSON out. Belt and suspenders against
  // prompt injection from untrusted transcripts.
  args.push("--allowedTools", "");
  args.push("--strict-mcp-config", "--mcp-config", files.mcpConfigFile);
  return args;
}

/** Env the child is allowed to see. API keys are deliberately not forwarded. */
function childEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "Path", "SystemRoot", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CLAUDE_CONFIG_DIR", "TEMP", "TMP"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of allow) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/** Kill the process (and on Windows its tree) so a timed-out run can't keep using the subscription. */
function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // process already gone
  }
}

/** True when the CLI's failure looks like a login/auth problem rather than a transient error. */
function looksNotSignedIn(text: string): boolean {
  return /log ?in|logged out|not authenticat|unauthori[sz]|sign ?in|credential|invalid api key|please run \/login|401/i.test(text);
}

export class ClaudeCodeProvider implements LlmProvider {
  readonly name = "claude-code";

  constructor(private model = "claude-opus-5-5", private timeoutMs = 120_000) {}

  async generateObject<T>(opts: GenerateObjectOptions<T>): Promise<T> {
    const resolved = resolveClaudeCommand();
    if (!resolved) throw new Error(NOT_FOUND_MESSAGE);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-code-"));
    const schemaFile = path.join(workDir, "schema.json");
    const mcpConfigFile = path.join(workDir, "mcp.json");
    const cwd = path.join(workDir, "cwd");
    try {
      fs.writeFileSync(schemaFile, JSON.stringify(z.toJSONSchema(opts.schema)));
      fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: {} }));
      fs.mkdirSync(cwd, { recursive: true });

      const args = [...resolved.prefixArgs, ...buildClaudeArgs(opts, { schemaFile, mcpConfigFile }, this.model)];
      const raw = await this.spawnClaude(resolved.command, args, opts.prompt, cwd);
      return this.parseResult(raw, opts.schema);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  private spawnClaude(command: string, args: string[], prompt: string, cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], shell: false });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killTree(child.pid);
      }, this.timeoutMs);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (e.code === "ENOENT") return reject(new Error(NOT_FOUND_MESSAGE));
        reject(new Error(`Could not start the Claude Code CLI: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error(`Claude Code CLI timed out after ${this.timeoutMs}ms.`));
        if (code !== 0) {
          if (looksNotSignedIn(`${stderr}\n${stdout}`)) return reject(new Error(NOT_SIGNED_IN_MESSAGE));
          // Don't echo raw stderr verbatim; it can carry home/config paths or token details.
          return reject(new Error(`Claude Code CLI exited with code ${code}.`));
        }
        resolve(stdout);
      });

      child.stdin.on("error", () => {
        /* broken pipe if the CLI exits early; the close handler reports the real cause */
      });
      child.stdin.end(prompt);
    });
  }

  private parseResult<T>(raw: string, schema: z.ZodType<T>): T {
    let envelope: { is_error?: boolean; result?: unknown; subtype?: string };
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new Error("Claude Code returned output that was not valid JSON.");
    }
    if (envelope.is_error) {
      if (typeof envelope.result === "string" && looksNotSignedIn(envelope.result)) throw new Error(NOT_SIGNED_IN_MESSAGE);
      throw new Error("Claude Code reported an error while generating the result.");
    }
    const inner = envelope.result;
    const text = typeof inner === "string" ? inner : JSON.stringify(inner);
    const parsed = extractJson(text);
    if (parsed === undefined) throw new Error("Claude Code returned a result that was not valid JSON.");
    return schema.parse(parsed);
  }
}

/**
 * Pull a JSON value out of the CLI's result text. `--json-schema` is meant to constrain the
 * output, but a real model may still wrap it in a ```json fence or a sentence of prose, so we
 * parse directly first, then retry on a fence's contents, then on the outermost {...}/[...] span.
 * Returns undefined when nothing parses.
 */
function extractJson(text: string): unknown {
  const candidates: string[] = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) candidates.push(obj[0]);
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) candidates.push(arr[0]);
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

// ----- readiness check (backs GET /api/claude-code/status) -----

let statusCache: { at: number; status: ClaudeCodeStatus } | null = null;
const STATUS_TTL_MS = 10_000;

/**
 * Report whether the CLI is installed and signed in, without reading credential contents.
 * Cached briefly so a refreshing Settings page can't fan out into many probes.
 */
export function checkClaudeCode(): ClaudeCodeStatus {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.status;
  const status = computeStatus();
  statusCache = { at: Date.now(), status };
  return status;
}

function computeStatus(): ClaudeCodeStatus {
  if (!resolveClaudeCommand()) return "not-found";
  return hasCredentials() ? "ok" : "not-signed-in";
}

/** Existence check only — we never open or read the credentials file. */
function hasCredentials(): boolean {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
  const candidates = [path.join(configDir, ".credentials.json"), path.join(configDir, "credentials.json")];
  return candidates.some((f) => fs.existsSync(f));
}
