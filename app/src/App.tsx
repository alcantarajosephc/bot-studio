import { useEffect, useState } from "react";
import type { ClaudeCodeStatus } from "../../shared/types";
import { APP_NAME } from "../../shared/brand";
import { useLive } from "./lib/live";
import { api } from "./lib/api";
import { CanvasView } from "./views/Canvas";
import { OfficeView } from "./views/Office";
import { EditorView } from "./views/Editor";
import { RevisionView } from "./views/Revision";
import { SettingsView } from "./views/Settings";
import { GuideView } from "./views/Guide";
import { BotPanel } from "./views/BotPanel";

export type Tab = "canvas" | "office" | "editor" | "review" | "guide" | "setup" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "canvas", label: "Canvas" },
  { id: "office", label: "Office view" },
  { id: "editor", label: "Video editor" },
  { id: "review", label: "Review" },
  { id: "guide", label: "How to use" },
  { id: "setup", label: "Setup guide" },
  { id: "settings", label: "Keys & models" },
];

function readHash(): Tab {
  const h = location.hash.replace("#", "") as Tab;
  return TABS.some((t) => t.id === h) ? h : "canvas";
}

export function App() {
  const live = useLive();
  const [tab, setTabState] = useState<Tab>(readHash);
  const [panel, setPanel] = useState<string | null>(null);
  const [reviewProject, setReviewProject] = useState<string | null>(null);
  const [cliStatus, setCliStatus] = useState<ClaudeCodeStatus | null>(null);
  const running = live.settings?.running ?? false;
  const usingClaudeCode = live.settings?.llm.provider === "claude-code";

  useEffect(() => {
    if (!usingClaudeCode) {
      setCliStatus(null);
      return;
    }
    let active = true;
    api.get<{ status: ClaudeCodeStatus }>("/api/claude-code/status")
      .then((r) => active && setCliStatus(r.status))
      .catch(() => active && setCliStatus("not-found"));
    return () => {
      active = false;
    };
  }, [usingClaudeCode]);

  useEffect(() => {
    const onHash = () => {
      setTabState(readHash());
      setPanel(null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setTab = (t: Tab) => {
    location.hash = t;
    setTabState(t);
    setPanel(null);
  };

  const openBot = (id: string) => {
    if (id === "editor") return setTab("editor");
    if (id === "revision") return setTab("review");
    setPanel(id);
  };

  // Only warn about setup problems the current selection actually has:
  // a missing key for a selected API provider, or a Claude Code CLI that isn't ready.
  const settings = live.settings;
  const anthropicProblem = !!settings && settings.llm.provider === "claude" && !settings.keys.anthropic;
  const groqProblem = !!settings && (settings.llm.provider === "groq" || settings.transcription.provider === "groq") && !settings.keys.groq;
  const cliProblem = usingClaudeCode && (cliStatus === "not-found" || cliStatus === "not-signed-in");
  const needsAttention = anthropicProblem || groqProblem || cliProblem;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <strong>{APP_NAME}</strong>
          <span className="brand-hint">tap any bot to see its settings</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
              title={t.id === "settings" && needsAttention ? "This setup needs attention" : undefined}
            >
              {t.label}
              {t.id === "settings" && needsAttention ? <span className="dot-warn" aria-hidden /> : null}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <span className={`conn ${live.connected ? "ok" : ""}`} title={live.connected ? "Connected to the bots" : "Server offline"} />
          <button
            className={`btn ${running ? "btn-running" : "btn-ghost"}`}
            onClick={() => api.post("/api/running", { running: !running })}
            title="When on, new videos go through the bots as soon as you drop them"
          >
            {running ? "● Running" : "○ Paused"}
          </button>
          <button className="btn btn-green" onClick={() => api.post("/api/run")}>
            ▶ Run everything
          </button>
        </div>
      </header>

      <main className="main">
        {tab === "canvas" && <CanvasView live={live} onOpenBot={openBot} />}
        {tab === "office" && <OfficeView live={live} onOpenBot={openBot} />}
        {tab === "editor" && (
          <EditorView
            live={live}
            onOpenReview={(id) => {
              setReviewProject(id);
              setTab("review");
            }}
          />
        )}
        {tab === "review" && <RevisionView live={live} projectId={reviewProject} onSelect={setReviewProject} />}
        {tab === "guide" && <GuideView kind="howto" />}
        {tab === "setup" && <GuideView kind="setup" />}
        {tab === "settings" && <SettingsView live={live} />}
      </main>

      {panel && <BotPanel id={panel} live={live} onClose={() => setPanel(null)} />}
    </div>
  );
}
