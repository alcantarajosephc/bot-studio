import fs from "node:fs";
import path from "node:path";
import { run } from "../server/media/ffmpeg.ts";
import { makeTestVideo } from "../tests/fixtures.ts";

export const FIXTURES = path.join(import.meta.dirname, ".fixtures");

/** Make the sample video and image the UI tests upload. */
export default async function globalSetup() {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const video = await makeTestVideo(FIXTURES, "sample.mp4");
  for (const name of ["clip1.mp4", "clip2.mp4", "clip3.mp4", "raw-talk.mp4"]) {
    const out = path.join(FIXTURES, name);
    if (!fs.existsSync(out)) fs.copyFileSync(video, out);
  }
  const png = path.join(FIXTURES, "screenshot.png");
  if (!fs.existsSync(png)) await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3a7bd5:s=640x400", "-frames:v", "1", png]);
}
