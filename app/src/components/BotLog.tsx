import { useEffect, useRef } from "react";
import type { LiveState } from "../lib/live";
import { Sprite } from "./Sprite";
import { fmtClock } from "../lib/format";

export function BotLog({ live }: { live: LiveState }) {
  const list = useRef<HTMLDivElement>(null);
  const colorByName = Object.fromEntries(live.metas.map((m) => [m.name, m.color]));
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [live.log.length]);
  return (
    <aside className="botlog">
      <div className="botlog-head">
        <div>
          <h3>Bot log</h3>
          <small>live updates</small>
        </div>
        <div className="botlog-sprites">
          {live.metas.map((m) => (
            <Sprite key={m.id} color={m.color} status={live.bots[m.id]?.status} size={18} />
          ))}
        </div>
      </div>
      <div className="botlog-list" ref={list}>
        {live.log.length === 0 ? <div className="empty">No activity yet. Drop a video to start.</div> : null}
        {live.log.map((l) => (
          <div key={l.id} className={`log-item ${l.level === "error" ? "error" : ""}`}>
            <Sprite color={colorByName[l.bot] ?? "gray"} status={l.level === "error" ? "error" : "idle"} size={22} />
            <div>
              <span className="who">{l.bot}</span>
              <span className="when">{fmtClock(l.at)}</span>
              <div className="msg">{l.message}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function StatusRows({ live, onOpen }: { live: LiveState; onOpen: (id: string) => void }) {
  return (
    <section className="statusrows">
      {live.metas.map((m) => {
        const s = live.bots[m.id];
        const status = s?.status ?? "idle";
        return (
          <div key={m.id} className="statusrow" onClick={() => onOpen(m.id)}>
            <Sprite color={m.color} status={status} size={24} />
            <span className="name">{m.name}</span>
            <span className="role">{m.role}</span>
            <span className="detail">{s?.detail ?? ""}</span>
            {s?.queue ? <span className="pill">{s.queue} queued</span> : null}
            <span className={`pill ${status}`}>{status === "off" ? "not connected" : status}</span>
          </div>
        );
      })}
    </section>
  );
}
