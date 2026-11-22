import { useEffect, useRef, useState } from "react";
import type { LiveState } from "../lib/live";
import { api } from "../lib/api";
import { Sprite } from "../components/Sprite";
import { fmtTime } from "../lib/format";

/** Review: watch a version, pause on a moment, leave a note there, copy the notes for the next revision. */
export function RevisionView({ live, projectId, onSelect }: { live: LiveState; projectId: string | null; onSelect: (id: string) => void }) {
  const projects = live.projects.filter((p) => p.versions.some((v) => v.status === "done"));
  const p = projects.find((x) => x.id === projectId) ?? projects[0];
  const done = p?.versions.filter((v) => v.status === "done") ?? [];
  const [ver, setVer] = useState<number | null>(null);
  const version = done.find((v) => v.v === ver) ?? done.at(-1);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const reviewBot = live.metas.find((m) => m.id === "revision");

  useEffect(() => setVer(null), [p?.id]);

  if (!p || !version) {
    return (
      <div className="page">
        <h1>Review</h1>
        <div className="empty">Nothing to review yet. Make an edit in the Video Editor first.</div>
      </div>
    );
  }

  const notes = p.notes.filter((n) => n.version === version.v);
  const seek = (t: number) => {
    if (video.current) video.current.currentTime = t;
    setTime(t);
  };

  const onVideoClick = () => {
    const v = video.current;
    if (!v) return;
    v.pause();
    setNoteAt(v.currentTime);
    setTimeout(() => input.current?.focus(), 0);
  };

  const add = async () => {
    if (!text.trim()) return;
    await api.post(`/api/projects/${p.id}/notes`, { version: version.v, time: noteAt ?? time, text });
    setText("");
    setNoteAt(null);
  };

  const copy = async () => {
    const lines = notes.filter((n) => !n.done).map((n) => `${fmtTime(n.time, 1)} ${n.text}`);
    const body = lines.join("\n");
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = body;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const bar = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * (dur || version.durationSec || 1));
  };
  const total = dur || version.durationSec || 1;

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        {reviewBot ? <Sprite color={reviewBot.color} status={live.bots.revision?.status} size={40} /> : null}
        <div>
          <h1>Review</h1>
          <p className="lede" style={{ margin: 0 }}>{(live.bots.revision?.status === "working" && live.bots.revision.detail) || "Pause where something needs fixing and write a note. Copy the notes into the editor to get the next version."}</p>
        </div>
      </div>
      <div className="review">
        <div className="review-top">
          <span className="review-badge">REVIEW</span>
          <select className="input" style={{ width: "auto" }} value={p.id} onChange={(e) => onSelect(e.target.value)}>
            {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <select className="input" style={{ width: "auto" }} value={version.v} onChange={(e) => setVer(Number(e.target.value))}>
            {done.map((v) => <option key={v.v} value={v.v}>v{v.v}</option>)}
          </select>
          <span className="hint">{p.name} · v{version.v}</span>
        </div>
        <div className="review-player">
          <video
            ref={video}
            key={`${p.id}-${version.v}`}
            src={`/media/editor/${p.id}/${version.file}?t=${version.createdAt}`}
            onClick={onVideoClick}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
            playsInline
          />
          <div className="review-bar" onClick={bar}>
            <div className="track" />
            <div className="played" style={{ width: `${(time / total) * 100}%` }} />
            {notes.map((n) => (
              <div key={n.id} className={`marker ${n.done ? "done" : ""}`} style={{ left: `${(n.time / total) * 100}%` }} title={n.text} />
            ))}
            <div className="head" style={{ left: `${(time / total) * 100}%` }} />
          </div>
          <div className="review-time row" style={{ justifyContent: "space-between" }}>
            <span>{fmtTime(time)} / {fmtTime(total)}</span>
            <button className="btn btn-sm" onClick={() => (video.current?.paused ? video.current.play() : video.current?.pause())}>Play / Pause</button>
          </div>
        </div>
        <div className="review-notes">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Notes</h3>
            <button className="btn btn-sm" onClick={copy} disabled={!notes.some((n) => !n.done)}>{copied ? "Copied!" : "Copy notes"}</button>
          </div>
          <input
            ref={input}
            className="input"
            placeholder={noteAt !== null ? `Note at ${fmtTime(noteAt, 1)}…` : "Pause the video and write a note"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-yellow btn-sm" onClick={add} disabled={!text.trim()}>Add note</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto" }}>
            {notes.length === 0 ? <div className="hint">No notes on v{version.v} yet.</div> : null}
            {notes.map((n) => (
              <div key={n.id} className="note">
                <span className="stamp" onClick={() => seek(n.time)}>{fmtTime(n.time, 1)}</span>
                <span>{n.text}</span>
                <div className="actions">
                  <button className={n.done ? "done-tag" : "todo-tag"} onClick={() => api.patch(`/api/projects/${p.id}/notes/${n.id}`, { done: !n.done })}>{n.done ? "done" : "to do"}</button>
                  <button className="todo-tag" onClick={() => api.del(`/api/projects/${p.id}/notes/${n.id}`)}>delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
