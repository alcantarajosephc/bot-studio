import { useEffect, useState } from "react";
import type { ClaudeCodeStatus, PublicSettings } from "../../../shared/types";
import type { LiveState } from "../lib/live";
import { api } from "../lib/api";

export function SettingsView({ live }: { live: LiveState }) {
  const s = live.settings;
  const [anthropic, setAnthropic] = useState("");
  const [groq, setGroq] = useState("");
  const [llm, setLlm] = useState(s?.llm);
  const [tr, setTr] = useState(s?.transcription);
  const [msg, setMsg] = useState("");
  const [cliStatus, setCliStatus] = useState<ClaudeCodeStatus>("checking");
  useEffect(() => {
    setLlm(s?.llm);
    setTr(s?.transcription);
  }, [JSON.stringify(s?.llm), JSON.stringify(s?.transcription)]); // eslint-disable-line react-hooks/exhaustive-deps

  const usingClaudeCode = llm?.provider === "claude-code";
  useEffect(() => {
    if (!usingClaudeCode) return;
    let active = true;
    setCliStatus("checking");
    api.get<{ status: ClaudeCodeStatus }>("/api/claude-code/status")
      .then((r) => active && setCliStatus(r.status))
      .catch(() => active && setCliStatus("not-found"));
    return () => {
      active = false;
    };
  }, [usingClaudeCode]);

  if (!s || !llm || !tr) return null;

  // Each API key is only "needed" when a provider that uses it is selected.
  const anthropicNeeded = llm.provider === "claude";
  const groqNeeded = llm.provider === "groq" || tr.provider === "groq";

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

  const keyBadge = (saved: boolean, needed: boolean) =>
    saved ? <span className="ok">✓ saved</span> : needed ? <span className="err">missing</span> : <span className="hint">optional — not needed for this setup</span>;

  return (
    <div className="page">
      <div style={{ maxWidth: 720 }}>
        <h1>Keys &amp; models</h1>
        <p className="lede">The default setup uses the Claude Code CLI and local Whisper, so no keys are required. Any keys you add stay on this computer (in <code>data/settings.json</code>) and are only sent to Anthropic and Groq.</p>

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label className="field">
            Anthropic API key (captions and edit plans) {keyBadge(s.keys.anthropic, anthropicNeeded)}
            <input className="input" type="password" autoComplete="off" placeholder={s.keys.anthropic ? "•••••••• (type to replace)" : "sk-ant-..."} value={anthropic} onChange={(e) => setAnthropic(e.target.value)} />
          </label>
          <label className="field">
            Groq API key (listening to videos) {keyBadge(s.keys.groq, groqNeeded)}
            <input className="input" type="password" autoComplete="off" placeholder={s.keys.groq ? "•••••••• (type to replace)" : "gsk_..."} value={groq} onChange={(e) => setGroq(e.target.value)} />
          </label>

          <div className="grid2">
            <label className="field">
              Writing model
              <select className="input" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value as typeof llm.provider })}>
                <option value="claude-code">Claude Code (no key)</option>
                <option value="claude">Claude</option>
                <option value="groq">Groq</option>
              </select>
            </label>
            <label className="field">
              {usingClaudeCode ? "Claude Code model" : llm.provider === "claude" ? "Claude model" : "Groq model"}
              <input
                className="input"
                value={usingClaudeCode ? llm.claudeCodeModel : llm.provider === "claude" ? llm.claudeModel : llm.groqModel}
                onChange={(e) =>
                  setLlm(
                    usingClaudeCode
                      ? { ...llm, claudeCodeModel: e.target.value }
                      : llm.provider === "claude"
                        ? { ...llm, claudeModel: e.target.value }
                        : { ...llm, groqModel: e.target.value },
                  )
                }
              />
            </label>
            <label className="field">
              Listening
              <select className="input" value={tr.provider} onChange={(e) => setTr({ ...tr, provider: e.target.value as "groq" | "local" })}>
                <option value="local">Local Whisper (free, slower)</option>
                <option value="groq">Groq Whisper (fast)</option>
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

          {usingClaudeCode ? <ClaudeCodeStatusRow status={cliStatus} /> : null}

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

function ClaudeCodeStatusRow({ status }: { status: ClaudeCodeStatus }) {
  return (
    <div className="field" role="status" aria-live="polite">
      {status === "checking" ? <span className="hint">Claude Code: checking…</span> : null}
      {status === "ok" ? <span className="ok">Claude Code: ✓ signed in</span> : null}
      {status === "not-found" ? (
        <span>
          <span className="err">Claude Code: not found</span>
          <span className="hint"> — Install the Claude Code CLI, then reload this page.</span>
        </span>
      ) : null}
      {status === "not-signed-in" ? (
        <span>
          <span className="err">Claude Code: not signed in</span>
          <span className="hint"> — Run <code>claude</code> once in a terminal and sign in, then reload this page.</span>
        </span>
      ) : null}
    </div>
  );
}
