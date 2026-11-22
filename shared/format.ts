/** 71.3 -> "1:11", or with decimals "1:11.3". */
export function fmtTime(sec: number, decimals = 0): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const whole = decimals ? rest.toFixed(decimals) : String(Math.floor(rest));
  const [int, frac] = whole.split(".");
  return `${m}:${int.padStart(2, "0")}${frac ? `.${frac}` : ""}`;
}

/** "1:50.7" or "110.7" -> seconds. Returns null if it isn't a timestamp. */
export function parseTime(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

/** 512 -> "512 B", 1536 -> "1.5 KB", 5242880 -> "5 MB". 1024-based, capped at GB. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const num = String(Math.round(value * 10) / 10);
  return `${num} ${units[i]}`;
}
