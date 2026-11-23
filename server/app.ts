import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { BotSystem } from "./system.ts";
import { getSettings, loadBotMeta, paths, publicSettings, ROOT, updateSettings } from "./config.ts";
import { assembleActiveCaption, deleteTraining, extractTrainingText, listTraining, saveTraining } from "./bots/caption.ts";
import { VIDEO_EXT } from "./bots/manager.ts";
import { checkClaudeCode } from "./providers/llm/claude-code.ts";

/** Top-level settings keys a client is allowed to persist. Anything else in the body is dropped. */
const SETTINGS_FIELDS = ["keys", "clearKeys", "llm", "transcription", "captionRules", "schedule", "running"] as const;

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(sys: BotSystem) {
  const { ctx, manager, editor } = sys;
  const app = express();
  const upload = multer({ dest: paths.tmp, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
  app.use(express.json({ limit: "2mb" }));

  // ----- state + live events -----
  app.get("/api/state", (_req, res) => {
    res.json({
      bots: loadBotMeta().map((meta) => ({ meta, state: ctx.bots[meta.id]?.state })),
      log: ctx.bus.log.slice(-150),
      videos: ctx.store.videos(),
      projects: ctx.store.projects(),
      settings: publicSettings(),
      training: listTraining(),
    });
  });

  app.get("/api/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const off = ctx.bus.onEvent((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  });

  // ----- videos (pipeline) -----
  app.post("/api/videos", upload.array("videos", 200), wrap(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const added = [];
    for (const f of files) {
      if (!VIDEO_EXT.has(path.extname(f.originalname).toLowerCase())) {
        fs.rmSync(f.path, { force: true });
        continue;
      }
      added.push(await manager.addVideo(f.path, f.originalname));
    }
    res.json({ added });
  }));

  app.post("/api/run", (_req, res) => {
    res.json({ started: manager.runEverything() });
  });

  app.post("/api/running", (req, res) => {
    const running = Boolean(req.body?.running);
    updateSettings({ running });
    ctx.bus.emit({ type: "settings", settings: publicSettings() });
    if (running) manager.runEverything();
    res.json({ running });
  });

  app.patch("/api/videos/:id", wrap((req, res) => {
    const v = ctx.store.video(String(req.params.id));
    if (!v) return res.status(404).json({ error: "Not found" });
    const patch: Parameters<typeof ctx.store.updateVideo>[1] = {};
    // Picking a hook option: rebuild the active caption from the chosen candidate.
    const sel = req.body.selectedCaption;
    const candidates = v.captionCandidates;
    if (candidates && Number.isInteger(sel) && sel >= 0 && sel < candidates.length) {
      const rules = getSettings().captionRules;
      patch.selectedCaption = sel;
      patch.caption = assembleActiveCaption(candidates[sel], rules, v.caption?.language ?? rules.language);
    }
    if (typeof req.body.captionText === "string" && v.caption) patch.caption = { ...(patch.caption ?? v.caption), text: req.body.captionText };
    if (req.body.schedule === null) patch.schedule = undefined;
    else if (req.body.schedule?.at) patch.schedule = { at: new Date(req.body.schedule.at).toISOString(), manual: true };
    if (patch.schedule && v.stage === "captioned") patch.stage = "scheduled";
    res.json(ctx.store.updateVideo(v.id, patch));
  }));

  app.post("/api/videos/:id/move", (req, res) => {
    ctx.store.moveVideo(String(req.params.id), req.body?.dir === -1 ? -1 : 1);
    manager.requestSchedule();
    res.json({ ok: true });
  });

  app.post("/api/videos/:id/redo", (req, res) => {
    const id = String(req.params.id);
    const v = ctx.store.video(id);
    if (!v) return res.status(404).json({ error: "Not found" });
    ctx.store.updateVideo(id, { stage: "new", error: undefined, caption: undefined, captionCandidates: undefined, selectedCaption: undefined, ...(req.body?.relisten ? { transcript: undefined } : {}) });
    manager.process(id);
    res.json({ ok: true });
  });

  app.delete("/api/videos/:id", (req, res) => {
    const v = ctx.store.video(String(req.params.id));
    if (v) {
      fs.rmSync(path.join(paths.videos, v.file), { force: true });
      if (v.thumbnail) fs.rmSync(path.join(paths.thumbs, v.thumbnail.file), { force: true });
      ctx.store.removeVideo(v.id);
    }
    res.json({ ok: true });
  });

  app.post("/api/schedule/apply", (_req, res) => {
    manager.requestSchedule();
    res.json({ ok: true });
  });

  // ----- settings -----
  app.get("/api/settings", (_req, res) => res.json(publicSettings()));
  app.get("/api/claude-code/status", (_req, res) => res.json({ status: checkClaudeCode() }));
  app.put("/api/settings", (req, res) => {
    // Allowlist top-level fields so a client can't persist arbitrary settings (e.g. an executable path).
    const body: Record<string, unknown> = {};
    for (const k of SETTINGS_FIELDS) if (req.body?.[k] !== undefined) body[k] = req.body[k];
    // Keys: only overwrite when a new key is typed; "" with clearKeys removes it.
    const inKeys = body.keys as Record<string, unknown> | undefined;
    const clearKeys = body.clearKeys as unknown[] | undefined;
    const keys: Record<string, string> = {};
    for (const k of ["anthropic", "groq"] as const) {
      const val = inKeys?.[k];
      if (typeof val === "string" && val.trim()) keys[k] = val.trim();
      if (Array.isArray(clearKeys) && clearKeys.includes(k)) keys[k] = "";
    }
    delete body.keys;
    delete body.clearKeys;
    if (Object.keys(keys).length) body.keys = keys;
    const schedule = body.schedule as { times?: unknown[] } | undefined;
    if (Array.isArray(schedule?.times)) schedule.times = schedule.times.slice(0, 20);
    updateSettings(body);
    const s = publicSettings();
    ctx.bus.emit({ type: "settings", settings: s });
    res.json(s);
  });

  // ----- caption style training -----
  app.get("/api/caption/training", (_req, res) => res.json(listTraining()));
  app.post("/api/caption/train", upload.array("files", 20), wrap(async (req, res) => {
    const saved: string[] = [];
    if (typeof req.body.text === "string" && req.body.text.trim()) saved.push(saveTraining("pasted-captions", req.body.text));
    for (const f of (req.files as Express.Multer.File[]) ?? []) {
      try {
        const text = await extractTrainingText(f.originalname, fs.readFileSync(f.path));
        if (text.trim()) saved.push(saveTraining(f.originalname, text));
      } finally {
        fs.rmSync(f.path, { force: true });
      }
    }
    ctx.bots.caption.log(`Learned from ${saved.length} new source${saved.length === 1 ? "" : "s"}.`);
    const training = listTraining();
    ctx.bus.emit({ type: "training", training });
    res.json({ saved, training });
  }));
  app.delete("/api/caption/training/:name", (req, res) => {
    deleteTraining(String(req.params.name));
    const training = listTraining();
    ctx.bus.emit({ type: "training", training });
    res.json(training);
  });

  // ----- video editor + review -----
  app.post(
    "/api/projects",
    upload.fields([{ name: "video", maxCount: 1 }, { name: "assets", maxCount: 50 }]),
    wrap((req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const video = files?.video?.[0];
      if (!video) return res.status(400).json({ error: "Add a video." });
      const p = editor.createProject({
        name: String(req.body.name ?? ""),
        videoPath: video.path,
        videoName: video.originalname,
        assets: (files.assets ?? []).map((a) => ({ path: a.path, name: a.originalname })),
      });
      if (req.body.start !== "false") editor.edit(p.id, String(req.body.instructions ?? ""));
      res.json(p);
    }),
  );
  app.post("/api/projects/:id/assets", upload.array("assets", 50), wrap((req, res) => {
    res.json(editor.addAssets(String(req.params.id), ((req.files as Express.Multer.File[]) ?? []).map((a) => ({ path: a.path, name: a.originalname }))));
  }));
  app.post("/api/projects/:id/edit", wrap((req, res) => {
    editor.edit(String(req.params.id), String(req.body?.instructions ?? ""));
    res.json({ ok: true });
  }));
  app.post("/api/projects/:id/revise", wrap((req, res) => {
    editor.revise(String(req.params.id), String(req.body?.notes ?? ""));
    res.json({ ok: true });
  }));
  app.get("/api/projects/:id/timeline/:v", (req, res) => {
    const t = editor.readTimeline(String(req.params.id), Number(req.params.v));
    return t ? res.json(t) : res.status(404).json({ error: "Not found" });
  });
  app.post("/api/projects/:id/notes", wrap((req, res) => {
    const { version, time, text } = req.body ?? {};
    if (!String(text ?? "").trim()) return res.status(400).json({ error: "Type a note." });
    res.json(editor.addNote(String(req.params.id), { version: Number(version), time: Number(time), text: String(text) }));
  }));
  app.patch("/api/projects/:id/notes/:noteId", wrap((req, res) => {
    editor.updateNote(String(req.params.id), String(req.params.noteId), req.body ?? {});
    res.json({ ok: true });
  }));
  app.delete("/api/projects/:id/notes/:noteId", wrap((req, res) => {
    editor.deleteNote(String(req.params.id), String(req.params.noteId));
    res.json({ ok: true });
  }));
  app.delete("/api/projects/:id", wrap((req, res) => {
    editor.deleteProject(String(req.params.id));
    res.json({ ok: true });
  }));

  // ----- media + built UI -----
  app.use("/media/videos", express.static(paths.videos));
  app.use("/media/thumbs", express.static(paths.thumbs));
  app.use("/media/editor", express.static(paths.editor));
  const dist = path.join(ROOT, "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message });
  });

  return app;
}
