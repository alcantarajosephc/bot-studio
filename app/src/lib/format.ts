export { fmtTime, parseTime } from "../../../shared/format";

/** 12340 -> "12.3K". Compact figures for the best-times summary. */
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Mon 12:10 PM" in the schedule's time zone. */
export function fmtSlot(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** ISO -> value for <input type="datetime-local"> in a given zone. */
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** <input type="datetime-local"> value in a zone -> ISO (UTC). */
export function fromLocalInput(value: string, timeZone: string): string {
  const asUtc = new Date(`${value}:00Z`);
  const shown = toLocalInput(asUtc.toISOString(), timeZone);
  const drift = new Date(`${shown}:00Z`).getTime() - asUtc.getTime();
  return new Date(asUtc.getTime() - drift).toISOString();
}
