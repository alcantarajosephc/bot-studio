import { useEffect, useState } from "react";
import type { PublicSettings } from "../../../shared/types";
import type { LiveState } from "../lib/live";
import { api } from "../lib/api";

export function SettingsView({ live }: { live: LiveState }) {
  const s = live.settings;
  const [anthropic, setAnthropic] = useState("");
  const [groq, setGroq] = useState("");
  const [llm, setLlm] = useState(s?.llm);
  const [tr, setTr] = useState(s?.transcription);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setLlm(s?.llm);
    setTr(s?.transcription);
  }, [JSON.stringify(s?.llm), JSON.stringify(s?.transcription)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !llm || !tr) return null;

  const save = async (extra: Record<string, unknown> = {}) => {
    try {
      await api.put<PublicSettings>("/api/settings", { keys: { anthropic, groq }, llm, transcription: tr, ...extra });
      setAnthropic("");
      setGroq("");
      setMsg("Saved on this computer.");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div style={{ maxWidth: 720 }}>
        <h1>Keys &amp; models</h1>
        <p className="lede">Your keys stay on this computer (in <code>data/settings.json</code>) and are only sent to Anthropic and Groq.</p>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="field">
            Anthropic API key (captions and edit plans) {s.keys.anthropic ? <span className="ok">✓ saved</span> : <span className="err">missing</span>}
            <input className="input" type="password" autoComplete="off" placeholder={s.keys.anthropic ? "•••••••• (type to replace)" : "sk-ant-..."} value={anthropic} onChange={(e) => setAnthropic(e.target.value)} />
          </label>
          <label className="field">
            Groq API key (listening to videos) {s.keys.groq ? <span className="ok">✓ saved</span> : <span className="err">missing</span>}
            <input className="input" type="password" autoComplete="off" placeholder={s.keys.groq ? "•••••••• (type to replace)" : "gsk_..."} value={groq} onChange={(e) => setGroq(e.target.value)} />
          </label>

          <div className="grid2">
            <label className="field">
              Writing model
              <select className="input" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value as "claude" | "groq" })}>
                <option value="claude">Claude</option>
                <option value="groq">Groq</option>
              </select>
            </label>
            <label className="field">
              {llm.provider === "claude" ? "Claude model" : "Groq model"}
              <input
                className="input"
                value={llm.provider === "claude" ? llm.claudeModel : llm.groqModel}
                onChange={(e) => setLlm(llm.provider === "claude" ? { ...llm, claudeModel: e.target.value } : { ...llm, groqModel: e.target.value })}
              />
            </label>
            <label className="field">
              Listening
              <select className="input" value={tr.provider} onChange={(e) => setTr({ ...tr, provider: e.target.value as "groq" | "local" })}>
                <option value="groq">Groq Whisper (fast)</option>
                <option value="local">Local Whisper (free, slower)</option>
              </select>
            </label>
            <label className="field">
              Spoken language
              <select className="input" value={tr.language} onChange={(e) => setTr({ ...tr, language: e.target.value as "auto" | "en" | "tl" })}>
                <option value="auto">Auto (best for Taglish)</option>
                <option value="en">English</option>
                <option value="tl">Tagalog</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-yellow" onClick={() => save()}>Save</button>
            {s.keys.anthropic ? <button className="btn btn-sm btn-danger" onClick={() => save({ clearKeys: ["anthropic"] })}>Remove Anthropic key</button> : null}
            {s.keys.groq ? <button className="btn btn-sm btn-danger" onClick={() => save({ clearKeys: ["groq"] })}>Remove Groq key</button> : null}
            <span className="ok">{msg}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
