import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EditPlan, EditorProject, RevisionNote, Timeline, Transcript } from "../../../shared/types.ts";
import type { BotContext } from "../../core/context.ts";
import { getSettings, paths } from "../../config.ts";
import { detectSilences, extractAudio, probe } from "../../media/ffmpeg.ts";
import { compileTimeline, outputToSource } from "./compile.ts";
import { buildEditPrompt, buildRevisePrompt, EditPlanSchema, nearestWord, parseNotes } from "./plan.ts";
import { renderTimeline } from "./render.ts";

export const ASSET_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".webm"]);
const FPS = 30;

export type Renderer = (timeline: Timeline, outFile: string, onProgress?: (p: number) => void) => Promise<void>;

/**
 * Video Editor + Review Bot.
 *   v1: Video Editor listens, Claude plans the edit, Remotion renders it.
 *   v2+: Review Bot turns your timestamped notes into a revised plan, Video Editor renders it.
 */
export class Editor {
  /** Where Remotion fetches source media from. Set by the server once it is listening. */
  mediaBase = "";
  render: Renderer = renderTimeline;

  constructor(private ctx: BotContext) {}

  private dir(id: string) {
    return this.ctx.store.projectDir(id);
  }

  createProject(input: { name: string; videoPath: string; videoName: string; assets: { path: string; name: string }[] }): EditorProject {
    const id = randomUUID().slice(0, 8);
    const dir = this.dir(id);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    const source = `source${path.extname(input.videoName).toLowerCase() || ".mp4"}`;
    moveFile(input.videoPath, path.join(dir, source));
    const assets: string[] = [];
    for (const a of input.assets) {
      const ext = path.extname(a.name).toLowerCase();
      if (!ASSET_EXT.has(ext)) continue;
      const safe = uniqueName(assets, a.name.replace(/[^\w.-]+/g, "_"));
      moveFile(a.path, path.join(dir, "assets", safe));
      assets.push(safe);
    }
    const p: EditorProject = { id, name: input.name || input.videoName, createdAt: new Date().toISOString(), source, assets, versions: [], notes: [] };
    this.ctx.store.saveProject(p);
    this.ctx.bots.editor.log(`New project "${p.name}" with ${assets.length} asset${assets.length === 1 ? "" : "s"}.`);
    return p;
  }

  addAssets(id: string, files: { path: string; name: string }[]): EditorProject {
    return this.ctx.store.updateProject(id, (p) => {
      for (const a of files) {
        if (!ASSET_EXT.has(path.extname(a.name).toLowerCase())) continue;
        const safe = uniqueName(p.assets, a.name.replace(/[^\w.-]+/g, "_"));
        moveFile(a.path, path.join(this.dir(id), "assets", safe));
        p.assets.push(safe);
      }
    });
  }

  /** Queue the first edit (v1). instructions: optional notes from the creator. */
  edit(id: string, instructions = ""): void {
    const p = this.ctx.store.project(id);
    if (!p) throw new Error("No such project");
    this.ctx.bots.editor.enqueue({ label: p.name, run: () => this.runEdit(id, instructions) });
  }

  /** Queue a revision from pasted notes ("1:50.7 zoom in on ..."). */
  revise(id: string, notesText: string): void {
    const p = this.ctx.store.project(id);
    if (!p) throw new Error("No such project");
    if (!p.versions.some((v) => v.status === "done" && v.plan)) throw new Error("Make the first edit before revising.");
    if (!notesText.trim()) throw new Error("Paste some notes first.");
    this.ctx.bots.revision.enqueue({ label: p.name, run: () => this.runRevise(id, notesText) });
  }

  private async analyze(p: EditorProject): Promise<EditorProject> {
    if (p.transcript && p.silences && p.sourceDuration) return p;
    const bot = this.ctx.bots.editor;
    const src = path.join(this.dir(p.id), p.source);
    const info = await probe(src);
    bot.setStatus("working", `Transcribing ${p.name}`);
    let transcript: Transcript = { text: "", words: [] };
    let silences: { start: number; end: number }[] = [];
    if (info.hasAudio) {
      const audio = path.join(paths.tmp, `edit-${p.id}.mp3`);
      await extractAudio(src, audio);
      try {
        transcript = await this.ctx.providers.transcriber().transcribe(audio, { language: getSettings().transcription.language });
      } finally {
        fs.rmSync(audio, { force: true });
      }
      silences = await detectSilences(src, info.duration);
    }
    bot.log(`Transcribed ${p.name}: ${transcript.words.length} words, ${silences.length} pauses.`);
    return this.ctx.store.updateProject(p.id, (x) => {
      x.transcript = transcript;
      x.silences = silences;
      x.sourceDuration = info.duration;
    });
  }

  private nextVersion(p: EditorProject): number {
    return p.versions.reduce((m, v) => Math.max(m, v.v), 0) + 1;
  }

  private async runEdit(id: string, instructions: string): Promise<void> {
    const bot = this.ctx.bots.editor;
    let p = this.ctx.store.project(id)!;
    const v = this.nextVersion(p);
    this.ctx.store.updateProject(id, (x) => x.versions.push({ v, createdAt: new Date().toISOString(), status: "planning" }));
    try {
      p = await this.analyze(p);
      bot.setStatus("working", `Planning the edit for ${p.name}`);
      const { system, prompt } = buildEditPrompt({ words: p.transcript!.words, duration: p.sourceDuration!, assets: p.assets, instructions });
      const plan = await this.ctx.providers.llm().generateObject({ system, prompt, schema: EditPlanSchema, effort: "high", maxTokens: 32000 });
      bot.log(`Plan for ${p.name} v${v}: ${summarize(plan)}.`);
      await this.renderVersion(id, v, plan);
    } catch (e) {
      this.markError(id, v, e);
      throw e;
    }
  }

  private async runRevise(id: string, notesText: string): Promise<void> {
    const reviewBot = this.ctx.bots.revision;
    const p = this.ctx.store.project(id)!;
    const prev = [...p.versions].reverse().find((x) => x.status === "done" && x.plan)!;
    const v = this.nextVersion(p);
    this.ctx.store.updateProject(id, (x) => x.versions.push({ v, createdAt: new Date().toISOString(), status: "planning", revisionNotes: notesText }));
    let plan: EditPlan;
    try {
      const parsed = parseNotes(notesText);
      reviewBot.setStatus("working", `Reading ${parsed.length} note${parsed.length === 1 ? "" : "s"} for ${p.name}`);
      const timeline = this.readTimeline(id, prev.v);
      const words = p.transcript?.words ?? [];
      const notes = parsed.map((n) => ({
        stamp: n.stamp,
        text: n.text,
        word: n.time !== null && timeline ? nearestWord(words, outputToSource(timeline, n.time)) : undefined,
      }));
      const { system, prompt } = buildRevisePrompt({ words, duration: p.sourceDuration ?? 0, assets: p.assets, previous: prev.plan!, version: prev.v, notes });
      plan = await this.ctx.providers.llm().generateObject({ system, prompt, schema: EditPlanSchema, effort: "high", maxTokens: 32000 });
      this.ctx.store.updateProject(id, (x) => {
        const ver = x.versions.find((y) => y.v === v);
        if (ver) ver.plan = plan;
        for (const n of x.notes) if (n.version === prev.v) n.done = true;
      });
      reviewBot.log(`Applied ${notes.length} note${notes.length === 1 ? "" : "s"} to ${p.name}. Sending v${v} to the Video Editor.`);
    } catch (e) {
      this.markError(id, v, e);
      throw e;
    }
    this.ctx.bots.editor.enqueue({
      label: `${p.name} v${v}`,
      run: async () => {
        try {
          await this.renderVersion(id, v, plan);
        } catch (e) {
          this.markError(id, v, e);
          throw e;
        }
      },
    });
  }

  private async renderVersion(id: string, v: number, plan: EditPlan): Promise<void> {
    const bot = this.ctx.bots.editor;
    const p = this.ctx.store.project(id)!;
    const info = await probe(path.join(this.dir(id), p.source));
    const base = `${this.mediaBase}/media/editor/${id}`;
    const timeline = compileTimeline(p.transcript?.words ?? [], p.silences ?? [], plan, {
      duration: p.sourceDuration ?? info.duration,
      fps: FPS,
      width: 1080,
      height: 1920,
      src: `${base}/${p.source}`,
      assetUrl: (a) => `${base}/assets/${encodeURIComponent(a)}`,
      assets: p.assets,
    });
    fs.writeFileSync(path.join(this.dir(id), `v${v}.timeline.json`), JSON.stringify(timeline));
    this.ctx.store.updateProject(id, (x) => {
      const ver = x.versions.find((y) => y.v === v)!;
      ver.plan = plan;
      ver.status = "rendering";
      ver.progress = 0;
    });
    bot.setStatus("working", `Rendering ${p.name} v${v}`);
    const file = `v${v}.mp4`;
    let lastSaved = 0;
    await this.render(timeline, path.join(this.dir(id), file), (progress) => {
      bot.setStatus("working", `Rendering ${p.name} v${v}: ${Math.round(progress * 100)}%`);
      if (progress - lastSaved >= 0.1) {
        lastSaved = progress;
        this.ctx.store.updateProject(id, (x) => {
          const ver = x.versions.find((y) => y.v === v);
          if (ver) ver.progress = progress;
        });
      }
    });
    this.ctx.store.updateProject(id, (x) => {
      const ver = x.versions.find((y) => y.v === v)!;
      ver.status = "done";
      ver.progress = 1;
      ver.file = file;
      ver.durationSec = timeline.durationInFrames / timeline.fps;
    });
    bot.log(`${p.name} v${v} is ready (${(timeline.durationInFrames / timeline.fps).toFixed(1)}s, was ${(p.sourceDuration ?? info.duration).toFixed(1)}s).`);
  }

  readTimeline(id: string, v: number): Timeline | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir(id), `v${v}.timeline.json`), "utf8"));
    } catch {
      return null;
    }
  }

  private markError(id: string, v: number, e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.ctx.store.updateProject(id, (x) => {
      const ver = x.versions.find((y) => y.v === v);
      if (ver) {
        ver.status = "error";
        ver.error = msg;
      }
    });
  }

  // ----- review notes -----

  addNote(id: string, note: { version: number; time: number; text: string }): RevisionNote {
    const n: RevisionNote = { id: randomUUID().slice(0, 8), version: note.version, time: Math.max(0, note.time), text: note.text.trim(), done: false };
    this.ctx.store.updateProject(id, (p) => {
      p.notes.push(n);
      p.notes.sort((a, b) => a.version - b.version || a.time - b.time);
    });
    return n;
  }

  updateNote(id: string, noteId: string, patch: Partial<Pick<RevisionNote, "text" | "done" | "time">>): void {
    this.ctx.store.updateProject(id, (p) => {
      const n = p.notes.find((x) => x.id === noteId);
      if (n) Object.assign(n, patch);
    });
  }

  deleteNote(id: string, noteId: string): void {
    this.ctx.store.updateProject(id, (p) => {
      p.notes = p.notes.filter((x) => x.id !== noteId);
    });
  }

  deleteProject(id: string): void {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
    this.ctx.bus.emit({ type: "project.removed", id });
  }
}

function summarize(plan: EditPlan): string {
  return [
    `${plan.removeWordRanges.length} cuts`,
    `${plan.emphasisWords.length} yellow words`,
    `${plan.callouts.length} callouts`,
    `${plan.inserts.length} inserts`,
    `${plan.zooms.length} zooms`,
    `${plan.titleCards.length} title cards`,
  ].join(", ");
}

function moveFile(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

function uniqueName(existing: string[], name: string): string {
  if (!existing.includes(name)) return name;
  const { name: base, ext } = path.parse(name);
  let i = 2;
  while (existing.includes(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}
