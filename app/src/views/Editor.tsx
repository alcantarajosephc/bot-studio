import { useEffect, useState } from "react";
import type { EditorProject } from "../../../shared/types";
import type { LiveState } from "../lib/live";
import { api } from "../lib/api";
import { Sprite } from "../components/Sprite";
import { fmtTime } from "../lib/format";

function NewProject({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const start = async () => {
    if (!video) return;
    const form = new FormData();
    form.append("name", name || video.name.replace(/\.[^.]+$/, ""));
    form.append("video", video, video.name);
    for (const a of assets) form.append("assets", a, a.name);
    form.append("instructions", instructions);
    setBusy(true);
    setErr("");
    try {
      const p = await api.form<EditorProject>("/api/projects", form);
      onCreated(p.id);
      setName("");
      setVideo(null);
      setAssets([]);
      setInstructions("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <strong>New edit</strong>
      <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning routine tips" /></label>
      <label className="field">Raw video (talking head)<input type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} /></label>
      <label className="field">Screenshots / B-roll (optional)<input type="file" multiple accept="image/*,video/*" onChange={(e) => setAssets([...(e.target.files ?? [])])} /></label>
      <label className="field">
        Notes for the editor (optional)
        <textarea className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Keep a banner 'DAY 1 OF 30' at the top for the first half." />
      </label>
      <button className="btn btn-yellow" disabled={!video || busy} onClick={start}>{busy ? "Uploading..." : "Edit it"}</button>
      {err ? <span className="err">{err}</span> : null}
    </div>
  );
}

function ProjectDetail({ p, live, onOpenReview }: { p: EditorProject; live: LiveState; onOpenReview: (id: string) => void }) {
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const busy = p.versions.some((v) => v.status === "planning" || v.status === "rendering");
  const hasDone = p.versions.some((v) => v.status === "done");
  const base = `/media/editor/${p.id}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{p.name}</h2>
          <div className="hint">
            source {p.sourceDuration ? fmtTime(p.sourceDuration) : "…"} · {p.assets.length} asset{p.assets.length === 1 ? "" : "s"}
            {p.transcript ? ` · ${p.transcript.words.length} words` : ""}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => onOpenReview(p.id)} disabled={!hasDone}>Open in Review</button>
          <button className="btn btn-danger" onClick={() => confirm(`Delete "${p.name}" and all its versions?`) && api.del(`/api/projects/${p.id}`)}>Delete</button>
        </div>
      </div>

      {p.assets.length ? (
        <div className="chips">
          {p.assets.map((a) => (
            <a key={a} className="chip" href={`${base}/assets/${encodeURIComponent(a)}`} target="_blank" rel="noreferrer">{a}</a>
          ))}
        </div>
      ) : null}
      <label className="hint">
        Add screenshots:{" "}
        <input
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={async (e) => {
            const form = new FormData();
            for (const f of e.target.files ?? []) form.append("assets", f, f.name);
            await api.form(`/api/projects/${p.id}/assets`, form);
            e.target.value = "";
          }}
        />
      </label>

      <div className="versions">
        {[...p.versions].reverse().map((v) => (
          <div key={v.v} className="version">
            {v.status === "done" && v.file ? <video src={`${base}/${v.file}?t=${v.createdAt}`} controls playsInline /> : <div style={{ width: 200, aspectRatio: "9/16", background: "#000", borderRadius: 8 }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row">
                <span className="vtag">v{v.v}</span>
                <strong>{v.status === "done" ? "Ready" : v.status === "error" ? "Failed" : v.status === "planning" ? "Planning the edit…" : "Rendering…"}</strong>
                {v.durationSec ? <span className="hint">{fmtTime(v.durationSec, 1)}</span> : null}
              </div>
              {v.status === "rendering" || v.status === "planning" ? (
                <div className="progress"><div style={{ width: `${Math.round((v.progress ?? 0) * 100)}%` }} /></div>
              ) : null}
              {v.error ? <div className="err">{v.error}</div> : null}
              {v.revisionNotes ? <div className="hint" style={{ whiteSpace: "pre-wrap" }}>Notes: {v.revisionNotes}</div> : null}
              {v.plan ? (
                <div className="hint">
                  {v.plan.removeWordRanges.length} cuts · {v.plan.emphasisWords.length} yellow words · {v.plan.callouts.length} callouts · {v.plan.inserts.length} inserts · {v.plan.zooms.length} zooms · {v.plan.titleCards.length} title cards
                </div>
              ) : null}
              {v.status === "done" && v.file ? (
                <div className="row">
                  <a className="btn btn-sm" href={`${base}/${v.file}`} download={`${p.name} v${v.v}.mp4`}>Download</a>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {p.versions.length === 0 ? <div className="empty">Starting…</div> : null}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Revise</strong>
        <span className="hint">In Review, pause on a moment, write what to change, then copy your notes and paste them here. One note per line, like <code>0:42.5 cut this pause</code>.</span>
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="0:12.0 make the caption bigger here" />
        <div className="row">
          <button
            className="btn btn-yellow"
            disabled={!notes.trim() || busy || !hasDone}
            onClick={async () => {
              setErr("");
              try {
                await api.post(`/api/projects/${p.id}/revise`, { notes });
                setNotes("");
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Make the next version
          </button>
          {!hasDone ? <span className="hint">Available once the first version is ready.</span> : null}
          {err ? <span className="err">{err}</span> : null}
          {p.versions.some((v) => v.status === "error") && !busy ? (
            <button className="btn" onClick={() => api.post(`/api/projects/${p.id}/edit`, {})}>Retry first edit</button>
          ) : null}
        </div>
      </div>

      {p.transcript ? (
        <div>
          <button className="btn btn-sm" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? "Hide" : "Show"} transcript</button>
          {showTranscript ? <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{p.transcript.text}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function EditorView({ live, onOpenReview }: { live: LiveState; onOpenReview: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const editor = live.metas.find((m) => m.id === "editor");
  const p = live.projects.find((x) => x.id === selected) ?? live.projects[0];
  useEffect(() => {
    if (!selected && live.projects[0]) setSelected(live.projects[0].id);
  }, [live.projects, selected]);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 4 }}>
        {editor ? <Sprite color={editor.color} status={live.bots.editor?.status} size={40} /> : null}
        <div>
          <h1>Video Editor</h1>
          <p className="lede" style={{ margin: 0 }}>{(live.bots.editor?.status === "working" && live.bots.editor.detail) || "Drop a raw talking-head video. The editor cuts dead air and retakes, adds captions, callouts, screenshots and zooms."}</p>
        </div>
      </div>
      {!live.settings?.keys.anthropic || !live.settings?.keys.groq ? <div className="banner" style={{ margin: "12px 0" }}>The editor needs a Groq key (to listen) and an Anthropic key (to plan the edit). Add them under Keys &amp; models.</div> : null}
      <div className="split" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <NewProject onCreated={setSelected} />
          <div className="plist">
            {live.projects.map((x) => {
              const last = x.versions.at(-1);
              return (
                <div key={x.id} className={`pitem ${p?.id === x.id ? "active" : ""}`} onClick={() => setSelected(x.id)}>
                  <strong>{x.name}</strong>
                  <div className="meta">{last ? `v${last.v} · ${last.status}` : "new"}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div>{p ? <ProjectDetail p={p} live={live} onOpenReview={onOpenReview} /> : <div className="empty">No edits yet.</div>}</div>
      </div>
    </div>
  );
}
