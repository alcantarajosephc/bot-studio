import fs from "node:fs";
import path from "node:path";
import type { EditorProject, VideoRecord } from "../../shared/types.ts";
import { paths } from "../config.ts";
import type { EventBus } from "./events.ts";

interface DbShape {
  videos: VideoRecord[];
}

/** Small JSON store for videos. Editor projects live in their own folders (project.json). */
export class Store {
  private db: DbShape;

  constructor(private bus: EventBus) {
    try {
      this.db = JSON.parse(fs.readFileSync(paths.db, "utf8"));
    } catch {
      this.db = { videos: [] };
    }
  }

  private save(): void {
    const tmp = `${paths.db}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, paths.db);
  }

  videos(): VideoRecord[] {
    return [...this.db.videos].sort((a, b) => a.order - b.order);
  }

  video(id: string): VideoRecord | undefined {
    return this.db.videos.find((v) => v.id === id);
  }

  addVideo(v: Omit<VideoRecord, "order">): VideoRecord {
    const order = this.db.videos.reduce((m, x) => Math.max(m, x.order), 0) + 1;
    const rec = { ...v, order };
    this.db.videos.push(rec);
    this.save();
    this.bus.emit({ type: "video", video: rec });
    return rec;
  }

  updateVideo(id: string, patch: Partial<VideoRecord>): VideoRecord {
    const v = this.video(id);
    if (!v) throw new Error(`No video ${id}`);
    Object.assign(v, patch);
    this.save();
    this.bus.emit({ type: "video", video: v });
    return v;
  }

  removeVideo(id: string): void {
    this.db.videos = this.db.videos.filter((v) => v.id !== id);
    this.save();
    this.bus.emit({ type: "video.removed", id });
  }

  /** Move a video up (-1) or down (+1) in the posting order. */
  moveVideo(id: string, dir: -1 | 1): void {
    const list = this.videos();
    const i = list.findIndex((v) => v.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = list[i];
    const b = list[j];
    [a.order, b.order] = [b.order, a.order];
    this.save();
    this.bus.emit({ type: "video", video: a });
    this.bus.emit({ type: "video", video: b });
  }

  // ----- editor projects -----

  projectDir(id: string): string {
    return path.join(paths.editor, id);
  }

  projects(): EditorProject[] {
    if (!fs.existsSync(paths.editor)) return [];
    return fs
      .readdirSync(paths.editor)
      .map((id) => this.project(id))
      .filter((p): p is EditorProject => Boolean(p))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  project(id: string): EditorProject | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.projectDir(id), "project.json"), "utf8"));
    } catch {
      return undefined;
    }
  }

  saveProject(p: EditorProject): EditorProject {
    fs.mkdirSync(this.projectDir(p.id), { recursive: true });
    fs.writeFileSync(path.join(this.projectDir(p.id), "project.json"), JSON.stringify(p, null, 2));
    this.bus.emit({ type: "project", project: p });
    return p;
  }

  updateProject(id: string, fn: (p: EditorProject) => void): EditorProject {
    const p = this.project(id);
    if (!p) throw new Error(`No project ${id}`);
    fn(p);
    return this.saveProject(p);
  }
}
