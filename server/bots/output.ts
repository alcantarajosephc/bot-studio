import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { BotContext } from "../core/context.ts";
import { getSettings, paths } from "../config.ts";

/**
 * Output folder: finished videos are copied here, each as three files side by side:
 *   tips-part1.mp4   the video
 *   tips-part1.jpg   its cover
 *   tips-part1.txt   its caption + hashtags
 * Edited videos from the Video Editor land here too ("My edit v2.mp4").
 * Point the folder at Google Drive for desktop to have everything synced.
 */

export function outputDir(): string {
  return getSettings().output.folder.trim() || paths.output;
}

/** "My Video.MOV" -> "My Video", with characters Windows won't allow in file names removed. */
export function fileBaseName(name: string): string {
  // Strip only the extension: path.parse would treat "/" or "\" inside the name as folders.
  const base = name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120)
    .trim();
  return base || "video";
}

/** base, or "base (2)", "base (3)"... so no file with any of the given extensions is overwritten. */
export function uniqueBase(dir: string, base: string, exts: string[]): string {
  const taken = (b: string) => exts.some((ext) => fs.existsSync(path.join(dir, `${b}${ext}`)));
  if (!taken(base)) return base;
  let i = 2;
  while (taken(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export function writeCaptionFile(dir: string, base: string, caption: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${base}.txt`), `${caption.trim()}\n`);
}

/** Copy a finished video, its cover and its caption into the output folder. */
export async function exportVideo(ctx: BotContext, videoId: string): Promise<void> {
  const v = ctx.store.video(videoId);
  if (!v) return;
  const dir = outputDir();
  fs.mkdirSync(dir, { recursive: true });
  const videoExt = path.extname(v.file).toLowerCase() || ".mp4";
  // Re-running a video reuses its own name in the same folder; a new video never overwrites another one.
  const base = v.output && v.output.folder === dir ? v.output.base : uniqueBase(dir, fileBaseName(v.originalName), [videoExt, ".jpg", ".txt"]);

  await fs.promises.copyFile(path.join(paths.videos, v.file), path.join(dir, `${base}${videoExt}`));
  const parts = ["video"];
  if (v.thumbnail) {
    await fs.promises.copyFile(path.join(paths.thumbs, v.thumbnail.file), path.join(dir, `${base}.jpg`));
    parts.push("cover");
  }
  if (v.caption) {
    writeCaptionFile(dir, base, v.caption.text);
    parts.push("caption");
  }
  ctx.store.updateVideo(v.id, { output: { folder: dir, base } });
  ctx.bots.manager.log(`Saved ${base} (${parts.join(", ")}) to ${dir}.`);
}

/** Copy a rendered edit into the output folder as "<project name> v<N>.mp4". */
export async function exportEdit(ctx: BotContext, projectName: string, version: number, renderedFile: string): Promise<string> {
  const dir = outputDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `${fileBaseName(projectName)} v${version}.mp4`;
  await fs.promises.copyFile(renderedFile, path.join(dir, name));
  ctx.bots.editor.log(`Saved ${name} to ${dir}.`);
  return name;
}

/** Open the folder in Explorer / Finder. Local-only route; the path comes from Settings. */
export function openFolder(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: false });
    p.on("error", (e) => reject(new Error(`Could not open the folder: ${e.message}`)));
    p.unref();
    // explorer.exe returns a non-zero exit code even on success, so don't wait for it.
    setTimeout(resolve, 100);
  });
}
