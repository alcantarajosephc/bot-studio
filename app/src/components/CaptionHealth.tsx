import { useMemo, useState, type ReactNode } from "react";
import type { CaptionRules, CaptionWarning } from "../../../shared/types";
import { lintCaption } from "../../../shared/caption-health";

const DISCLAIMER = "Guidance based on common platform patterns — not a guarantee, and it never blocks posting.";

function summary(count: number): string {
  return count === 0 ? "Caption health · looks good" : `Caption health · ${count} possible reach risk${count === 1 ? "" : "s"}`;
}

/** Render the warning reason with the offending token wrapped in a <mark> pill (plain text, auto-escaped). */
function withToken(message: string, token: string): ReactNode {
  const at = token ? message.indexOf(token) : -1;
  if (at < 0) return message;
  return (
    <>
      {message.slice(0, at)}
      <mark className="health-mark">{token}</mark>
      {message.slice(at + token.length)}
    </>
  );
}

/**
 * Advisory "Caption health" chip. Green when the caption is clean, amber with a count otherwise.
 * `interactive` turns it into an expandable button (caption editor / rows); the read-only variant
 * (library / posting) shows the chip with a title summary and no expansion. Never blocks anything.
 */
export function CaptionHealth({ text, rules, interactive = false }: { text: string; rules?: Partial<CaptionRules>; interactive?: boolean }) {
  const [open, setOpen] = useState(false);
  const health = useMemo(() => lintCaption(text, rules ?? {}), [text, rules]);
  const n = health.warnings.length;
  const healthy = health.healthy;
  const label = summary(n);
  const title = healthy ? label : `${label}: ${health.warnings.map((w) => w.token).join(", ")}`;

  if (!interactive) {
    return (
      <span className={`health-chip ${healthy ? "ok" : "warn"}`} title={title}>
        {healthy ? "✓ " : "⚠ "}
        {label}
      </span>
    );
  }

  return (
    <div className="caption-health">
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        className={`health-chip ${healthy ? "ok" : "warn"}`}
        aria-expanded={open}
        aria-label={healthy ? "Caption health: looks good" : `Caption health: ${n} possible reach risk${n === 1 ? "" : "s"}, expand for details`}
        onClick={() => setOpen((v) => !v)}
        disabled={healthy}
      >
        {healthy ? "✓ " : "⚠ "}
        {label}
      </button>
      {open && !healthy ? (
        <div className="card health-panel">
          <ul className="health-list" role="list">
            {health.warnings.map((w: CaptionWarning, i) => (
              <li key={`${w.type}-${w.token}-${i}`}>{withToken(w.message, w.token)}</li>
            ))}
          </ul>
          <p className="help">{DISCLAIMER}</p>
        </div>
      ) : null}
    </div>
  );
}
