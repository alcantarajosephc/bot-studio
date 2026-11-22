import { spawn } from "node:child_process";

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => reject(new Error(`Could not start ${cmd}: ${e.message}. Is it installed?`)));
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-800)}`));
    });
  });
}

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(stdout.toString()) as {
    format: { duration?: string };
    streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const [n, d] = (v?.r_frame_rate ?? "30/1").split("/").map(Number);
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.[0]?.rotation ?? 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  return {
    duration: Number(j.format.duration ?? 0),
    width,
    height,
    fps: d ? n / d : 30,
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

/** Small mono MP3 for speech-to-text (keeps uploads well under API size limits). */
export async function extractAudio(file: string, out: string): Promise<void> {
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", out]);
}

/** Grayscale frames at the given times, as raw pixel buffers (for scoring). */
export async function grayFrames(file: string, times: number[], width: number, height: number): Promise<Buffer[]> {
  const frames: Buffer[] = [];
  for (const t of times) {
    const { stdout } = await run("ffmpeg", [
      "-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1",
      "-vf", `scale=${width}:${height},format=gray`, "-f", "rawvideo", "-",
    ]);
    frames.push(stdout.subarray(0, width * height));
  }
  return frames;
}

export async function extractFrame(file: string, time: number, out: string): Promise<void> {
  await run("ffmpeg", ["-v", "error", "-y", "-ss", time.toFixed(3), "-i", file, "-frames:v", "1", "-q:v", "2", out]);
}

/** Quiet stretches in the audio, from ffmpeg's silencedetect filter. */
export function parseSilences(stderr: string, duration: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end: ([\d.]+)/);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: duration });
  return out;
}

export async function detectSilences(file: string, duration: number, noiseDb = -32, minSec = 0.45): Promise<{ start: number; end: number }[]> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`, "-f", "null", "-"]);
  return parseSilences(stderr, duration);
}
