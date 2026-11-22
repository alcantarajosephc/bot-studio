import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CaptionRules, PublicSettings, ScheduleSettings, VideoRecord } from "../../../shared/types";
import type { LiveState } from "../lib/live";
import { api, uploadVideos } from "../lib/api";
import { Sprite } from "../components/Sprite";
import { fmtDateTime, fmtTime, fromLocalInput, toLocalInput } from "../lib/format";

const STAGE_LABEL: Record<VideoRecord["stage"], string> = {
  new: "waiting",
  thumbnail: "thumbnail",
  captioning: "captioning",
  captioned: "captioned",
  scheduled: "scheduled",
  error: "error",
};

export function BotPanel({ id, live, onClose }: { id: string; live: LiveState; onClose: () => void }) {
  const meta = live.metas.find((m) => m.id === id);
  const state = live.bots[id];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = id === "library" ? "Drop videos" : (meta?.name ?? id);
  const sub = id === "library" ? "Every video the bots know about" : meta?.personality;
  let body: ReactNode = null;
  if (id === "library") body = <Library live={live} />;
  else if (id === "thumbnail") body = <ThumbnailPanel live={live} />;
  else if (id === "caption") body = <CaptionPanel live={live} />;
  else if (id === "scheduler") body = <SchedulerPanel live={live} />;
  else if (id === "posting") body = <PostingPanel live={live} />;
  else if (id === "manager") body = <ManagerPanel live={live} />;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head">
          {meta ? <Sprite color={meta.color} status={state?.status} size={44} /> : <span className="node-icon">📥</span>}
          <div>
            <h2>{title}</h2>
            <p>{sub}</p>
            {state?.detail ? <p>Now: {state.detail}</p> : null}
          </div>
          <button className="btn btn-sm close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{body}</div>
      </aside>
    </>
  );
}

// ---------- shared bits ----------

function useSettingsDraft<K extends "captionRules" | "schedule">(live: LiveState, key: K) {
  const saved = live.settings?.[key] as PublicSettings[K] | undefined;
  const [draft, setDraft] = useState(saved);
  const [msg, setMsg] = useState("");
  useEffect(() => setDraft(saved), [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async () => {
    try {
      await api.put("/api/settings", { [key]: draft });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1500);
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  };
  return { draft, setDraft, dirty, save, msg };
}

function VideoRow({ v, live, children }: { v: VideoRecord; live: LiveState; children?: ReactNode }) {
  const tz = live.settings?.schedule.timezone ?? "Asia/Manila";
  return (
    <div className="vitem">
      {v.thumbnail ? <img src={`/media/thumbs/${v.thumbnail.file}`} alt="" /> : <div className="noimg" />}
      <div style={{ minWidth: 0 }}>
        <div className="title">{v.originalName}</div>
        <div className="meta">
          <span className={`chip ${v.stage === "error" ? "chip-red" : v.stage === "scheduled" ? "chip-green" : ""}`}>{STAGE_LABEL[v.stage]}</span>{" "}
          {v.duration ? `${fmtTime(v.duration)} · ` : ""}
          {v.schedule ? `posts ${fmtDateTime(v.schedule.at, tz)}${v.schedule.manual ? " (your time)" : ""}` : ""}
        </div>
        {v.error ? <div className="err">{v.error}</div> : null}
        {children}
      </div>
      <div className="side">
        <button className="btn btn-sm" onClick={() => api.post(`/api/videos/${v.id}/redo`, {})} title="Run this video through the bots again">↻ Redo</button>
        <button className="btn btn-sm btn-danger" onClick={() => confirm(`Remove ${v.originalName}?`) && api.del(`/api/videos/${v.id}`)}>Remove</button>
      </div>
    </div>
  );
}

// ---------- library ----------

function Library({ live }: { live: LiveState }) {
  const [msg, setMsg] = useState("");
  return (
    <>
      <section className="section">
        <h3>Add videos</h3>
        <p className="help">Drag videos onto the Drop videos node, pick them here, or copy them into the <code>data/inbox</code> folder.</p>
        <input
          type="file"
          accept="video/*"
          multiple
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            if (!files.length) return;
            setMsg("Uploading...");
            try {
              const r = await uploadVideos(files);
              setMsg(`Added ${r.added.length} video${r.added.length === 1 ? "" : "s"}.${live.settings?.running ? "" : " Press Run everything to start."}`);
            } catch (err) {
              setMsg((err as Error).message);
            }
            e.target.value = "";
          }}
        />
        {msg ? <p className="hint">{msg}</p> : null}
      </section>
      <section className="section">
        <h3>Videos ({live.videos.length})</h3>
        <div className="vlist">
          {live.videos.length === 0 ? <div className="empty">No videos yet.</div> : null}
          {live.videos.map((v) => (
            <VideoRow key={v.id} v={v} live={live}>
              {v.caption ? <div className="caption">{v.caption.text}</div> : null}
            </VideoRow>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------- thumbnail ----------

function ThumbnailPanel({ live }: { live: LiveState }) {
  const withThumb = live.videos.filter((v) => v.thumbnail);
  return (
    <section className="section">
      <h3>Covers</h3>
      <p className="help">The bot samples up to 40 frames per video and keeps the clearest, best-exposed one.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
        {withThumb.length === 0 ? <div className="empty">No covers yet.</div> : null}
        {withThumb.map((v) => (
          <figure key={v.id} style={{ margin: 0 }}>
            <a href={`/media/thumbs/${v.thumbnail!.file}`} target="_blank" rel="noreferrer">
              <img src={`/media/thumbs/${v.thumbnail!.file}`} alt="" style={{ width: "100%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 8 }} />
            </a>
            <figcaption className="hint">
              {v.originalName}
              <br />
              frame at {fmtTime(v.thumbnail!.time)}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ---------- SEO caption ----------

function CaptionPanel({ live }: { live: LiveState }) {
  const { draft, setDraft, dirty, save, msg } = useSettingsDraft(live, "captionRules");
  const [paste, setPaste] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [trainMsg, setTrainMsg] = useState("");
  if (!draft) return null;
  const set = (p: Partial<CaptionRules>) => setDraft({ ...draft, ...p });

  const train = async () => {
    const form = new FormData();
    if (paste.trim()) form.append("text", paste);
    for (const f of files) form.append("files", f, f.name);
    setTrainMsg("Learning...");
    try {
      const r = await api.form<{ saved: string[] }>("/api/caption/train", form);
      setTrainMsg(`Learned from ${r.saved.length} source${r.saved.length === 1 ? "" : "s"}.`);
      setPaste("");
      setFiles([]);
    } catch (e) {
      setTrainMsg((e as Error).message);
    }
  };

  return (
    <>
      {!live.settings?.keys.anthropic || !live.settings?.keys.groq ? (
        <div className="banner">The caption bot needs a Groq key (to listen) and an Anthropic key (to write). Add them under Keys &amp; models.</div>
      ) : null}
      <section className="section">
        <h3>My rules</h3>
        <p className="help">How the bot writes every caption.</p>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row">
            <span className="hint" style={{ width: 90 }}>Language</span>
            <div className="toggle-group">
              {(["en", "tl", "taglish"] as const).map((l) => (
                <button key={l} className={draft.language === l ? "on" : ""} onClick={() => set({ language: l })}>
                  {l === "en" ? "English" : l === "tl" ? "Tagalog" : "Taglish"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid2">
            <label className="field">
              Keywords per caption
              <input className="input" type="number" min={1} max={15} value={draft.keywordCount} onChange={(e) => set({ keywordCount: Number(e.target.value) })} />
            </label>
            <label className="field">
              Max caption length (characters)
              <input className="input" type="number" min={50} max={2200} value={draft.maxLength} onChange={(e) => set({ maxLength: Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={draft.hashtags} onChange={(e) => set({ hashtags: e.target.checked })} /> Hashtags
            </label>
            {draft.hashtags ? (
              <label className="row" style={{ gap: 6 }}>
                how many
                <input className="input" style={{ width: 70 }} type="number" min={1} max={30} value={draft.hashtagCount} onChange={(e) => set({ hashtagCount: Number(e.target.value) })} />
              </label>
            ) : null}
          </div>
          <label className="field">
            Anything else the bot should always do
            <textarea className="input" placeholder="e.g. Always mention my shop link in bio. Never use emojis." value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn btn-yellow" disabled={!dirty} onClick={save}>Save rules</button>
            <span className="ok">{msg}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>Teach it your style</h3>
        <p className="help">Paste captions you've written before, or add a PDF, DOCX or TXT with examples or guidelines. It's kept on this computer and used as a style guide.</p>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea className="input" placeholder="Paste a few of your best captions here..." value={paste} onChange={(e) => setPaste(e.target.value)} />
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          <div className="row">
            <button className="btn btn-yellow" disabled={!paste.trim() && !files.length} onClick={train}>Train</button>
            <span className="hint">{trainMsg}</span>
          </div>
          {live.training.length ? (
            <div className="chips">
              {live.training.map((t) => (
                <span key={t.name} className="chip" title={`${t.chars} characters`}>
                  {t.name.replace(/^\d+-/, "")}{" "}
                  <button className="btn btn-sm" style={{ padding: "0 4px", border: 0 }} onClick={() => api.del(`/api/caption/training/${encodeURIComponent(t.name)}`)}>✕</button>
                </span>
              ))}
            </div>
          ) : (
            <span className="hint">Nothing learned yet.</span>
          )}
        </div>
      </section>

      <section className="section">
        <h3>Captions</h3>
        <p className="help">Edit any caption before it posts.</p>
        <div className="vlist">
          {live.videos.filter((v) => v.caption).length === 0 ? <div className="empty">No captions yet.</div> : null}
          {live.videos.filter((v) => v.caption).map((v) => (
            <CaptionEditor key={v.id} v={v} live={live} />
          ))}
        </div>
      </section>
    </>
  );
}

function CaptionEditor({ v, live }: { v: VideoRecord; live: LiveState }) {
  const [text, setText] = useState(v.caption!.text);
  useEffect(() => setText(v.caption!.text), [v.caption!.text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <VideoRow v={v} live={live}>
      <textarea className="input" style={{ marginTop: 6 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn btn-sm" disabled={text === v.caption!.text} onClick={() => api.patch(`/api/videos/${v.id}`, { captionText: text })}>Save caption</button>
        <div className="chips">{v.caption!.keywords.map((k) => <span key={k} className="chip chip-yellow">{k}</span>)}</div>
      </div>
    </VideoRow>
  );
}

// ---------- scheduler ----------

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function SchedulerPanel({ live }: { live: LiveState }) {
  const { draft, setDraft, dirty, save, msg } = useSettingsDraft(live, "schedule");
  if (!draft) return null;
  const set = (p: Partial<ScheduleSettings>) => setDraft({ ...draft, ...p });
  const tz = draft.timezone;
  const queue = live.videos.filter((v) => v.stage === "captioned" || v.stage === "scheduled");

  return (
    <>
      <section className="section">
        <h3>When to post</h3>
        <p className="help">Set which days to post and how times are chosen. Videos get slots in the order shown below.</p>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="toggle-group">
            {([["every", "Every day"], ["weekdays", "Weekdays"], ["mwf", "Mon-Wed-Fri"], ["custom", "My days"]] as const).map(([k, label]) => (
              <button key={k} className={draft.days === k ? "on" : ""} onClick={() => set({ days: k })}>{label}</button>
            ))}
          </div>
          {draft.days === "custom" ? (
            <div className="toggle-group">
              {DAY_NAMES.map((d, i) => (
                <button
                  key={d}
                  className={`daybtn ${draft.customDays.includes(i + 1) ? "on" : ""}`}
                  onClick={() => set({ customDays: draft.customDays.includes(i + 1) ? draft.customDays.filter((x) => x !== i + 1) : [...draft.customDays, i + 1] })}
                >
                  {d}
                </button>
              ))}
            </div>
          ) : null}
          <div className="toggle-group">
            <button className={draft.mode === "auto" ? "on" : ""} onClick={() => set({ mode: "auto" })}>Auto spread</button>
            <button className={draft.mode === "times" ? "on" : ""} onClick={() => set({ mode: "times" })}>Pick the times</button>
          </div>
          {draft.mode === "auto" ? (
            <>
              <div className="grid2">
                <label className="field">From<input className="input" type="time" value={draft.window.start} onChange={(e) => set({ window: { ...draft.window, start: e.target.value } })} /></label>
                <label className="field">Until<input className="input" type="time" value={draft.window.end} onChange={(e) => set({ window: { ...draft.window, end: e.target.value } })} /></label>
              </div>
              <label className="field">
                Posts a day (when you have 10+ videos, up to 100)
                <input className="input" type="number" min={1} max={100} value={draft.perDay} onChange={(e) => set({ perDay: Number(e.target.value) })} />
              </label>
              <span className="hint">With fewer than 10 videos it posts them all in one day. With 10 or more it spreads them out, {draft.perDay} a day.</span>
            </>
          ) : (
            <>
              <div className="chips">
                {draft.times.map((t, i) => (
                  <span key={i} className="chip" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <input className="input" type="time" style={{ width: 110, padding: "2px 6px" }} value={t} onChange={(e) => set({ times: draft.times.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <button className="btn btn-sm" style={{ border: 0, padding: "0 4px" }} onClick={() => set({ times: draft.times.filter((_, j) => j !== i) })}>✕</button>
                  </span>
                ))}
                {draft.times.length < 20 ? <button className="btn btn-sm" onClick={() => set({ times: [...draft.times, "12:00"] })}>+ time</button> : null}
              </div>
              <span className="hint">Up to 20 a day.</span>
            </>
          )}
          <label className="field">
            Time zone
            <input className="input" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} list="tzs" />
            <datalist id="tzs">
              {["Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "America/Los_Angeles", "America/New_York", "Europe/London", "UTC"].map((z) => <option key={z} value={z} />)}
            </datalist>
          </label>
          <div className="row">
            <button
              className="btn btn-yellow"
              disabled={!dirty}
              onClick={async () => {
                if (await save()) await api.post("/api/schedule/apply");
              }}
            >
              Save and reschedule
            </button>
            <span className="ok">{msg}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h3>This week</h3>
        <WeekGrid live={live} schedule={live.settings!.schedule} />
      </section>

      <section className="section">
        <h3>Posting order</h3>
        <p className="help">Set an exact time for any video, or change the order with the arrows.</p>
        <div className="vlist">
          {queue.length === 0 ? <div className="empty">Nothing to schedule yet.</div> : null}
          {queue.map((v, i) => (
            <div key={v.id} className="vitem" style={{ gridTemplateColumns: "54px 1fr auto" }}>
              {v.thumbnail ? <img src={`/media/thumbs/${v.thumbnail.file}`} alt="" /> : <div className="noimg" />}
              <div>
                <div className="title">{v.originalName}</div>
                <div className="meta">{v.schedule ? fmtDateTime(v.schedule.at, tz) : "not scheduled"}{v.schedule?.manual ? " · your time" : ""}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <input
                    className="input"
                    type="datetime-local"
                    style={{ width: 210 }}
                    value={v.schedule ? toLocalInput(v.schedule.at, tz) : ""}
                    onChange={(e) => e.target.value && api.patch(`/api/videos/${v.id}`, { schedule: { at: fromLocalInput(e.target.value, tz) } })}
                  />
                  {v.schedule?.manual ? (
                    <button className="btn btn-sm" onClick={async () => { await api.patch(`/api/videos/${v.id}`, { schedule: null }); await api.post("/api/schedule/apply"); }}>Let the bot pick</button>
                  ) : null}
                </div>
              </div>
              <div className="side">
                <button className="btn btn-sm" disabled={i === 0} onClick={() => api.post(`/api/videos/${v.id}/move`, { dir: -1 })}>▲</button>
                <button className="btn btn-sm" disabled={i === queue.length - 1} onClick={() => api.post(`/api/videos/${v.id}/move`, { dir: 1 })}>▼</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function WeekGrid({ live, schedule }: { live: LiveState; schedule: ScheduleSettings }) {
  const tz = schedule.timezone;
  const allowed = useMemo(() => {
    switch (schedule.days) {
      case "every": return [1, 2, 3, 4, 5, 6, 7];
      case "weekdays": return [1, 2, 3, 4, 5];
      case "mwf": return [1, 3, 5];
      default: return schedule.customDays;
    }
  }, [schedule]);
  // Next 7 days starting today, in the schedule's zone.
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000));
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const weekday = (d: Date) => ((["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" }))) + 1);
  const byDay = new Map<string, string[]>();
  const sorted = live.videos.filter((v) => v.schedule).map((v) => v.schedule!.at).sort();
  for (const at of sorted) {
    const k = key(new Date(at));
    byDay.set(k, [...(byDay.get(k) ?? []), new Date(at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })]);
  }
  return (
    <div className="card">
      <div className="hint" style={{ marginBottom: 6 }}>Next 7 days · {tz}</div>
      <div className="week" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {days.map((d) => (
          <div key={key(d)} className="dh">{d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", day: "numeric" })}</div>
        ))}
        {days.map((d) => (
          <div key={`c${key(d)}`} className={`cell ${allowed.includes(weekday(d)) ? "" : "off"}`}>
            {(byDay.get(key(d)) ?? []).map((t, i) => <span key={i} className="t">{t}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- posting + manager ----------

function PostingPanel({ live }: { live: LiveState }) {
  const tz = live.settings?.schedule.timezone ?? "Asia/Manila";
  const waiting = live.videos.filter((v) => v.stage === "scheduled");
  return (
    <>
      <div className="banner">Posting isn't connected yet. Your videos keep their thumbnails, captions and times, ready for when it is.</div>
      <section className="section">
        <h3>Waiting to post ({waiting.length})</h3>
        <div className="vlist">
          {waiting.map((v) => (
            <VideoRow key={v.id} v={v} live={live}>
              <div className="caption">{v.caption?.text}</div>
              <div className="hint">{v.schedule ? fmtDateTime(v.schedule.at, tz) : ""}</div>
            </VideoRow>
          ))}
        </div>
      </section>
    </>
  );
}

function ManagerPanel({ live }: { live: LiveState }) {
  const count = (s: VideoRecord["stage"]) => live.videos.filter((v) => v.stage === s).length;
  return (
    <section className="section">
      <h3>Team status</h3>
      <div className="grid2">
        {([["new", "Waiting"], ["captioning", "Captioning"], ["captioned", "Captioned"], ["scheduled", "Scheduled"], ["error", "Need attention"]] as const).map(([s, label]) => (
          <div key={s} className="card">
            <div className="hint">{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{count(s)}</div>
          </div>
        ))}
      </div>
      <p className="help" style={{ marginTop: 12 }}>Videos move through the cover, caption, scheduling and posting steps in order. Press Run everything to start anything that's waiting or failed.</p>
      <button className="btn btn-green" onClick={() => api.post("/api/run")}>▶ Run everything</button>
    </section>
  );
}
