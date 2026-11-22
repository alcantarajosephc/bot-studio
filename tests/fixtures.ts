import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../server/media/ffmpeg.ts";

/**
 * 6s portrait test video:
 *  - picture is blurred and dark everywhere except 3s..4s (sharp and bright),
 *  - audio is a tone with a silent gap at 2s..3s.
 */
export async function makeTestVideo(dir: string, name = "sample.mp4"): Promise<string> {
  const out = path.join(dir, name);
  if (fs.existsSync(out)) return out;
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x568:duration=6:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=44100",
    "-filter_complex",
    "[0:v]boxblur=luma_radius=12:luma_power=2:enable='not(between(t,3,4))',eq=eval=frame:brightness='if(between(t,3,4),0.05,-0.35)'[v];" +
      "[1:a]volume=enable='between(t,2,3)':volume=0[a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
  return out;
}

export function tempDir(prefix = "bots-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
