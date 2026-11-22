import { useCallback, useEffect, useState } from "react";
import type { BotMeta, BotState, EditorProject, LogEntry, PublicSettings, ServerEvent, VideoRecord } from "../../../shared/types";
import { api } from "./api";

export interface LiveState {
  metas: BotMeta[];
  bots: Record<string, BotState>;
  log: LogEntry[];
  videos: VideoRecord[];
  projects: EditorProject[];
  settings: PublicSettings | null;
  training: { name: string; chars: number }[];
  connected: boolean;
}

const empty: LiveState = { metas: [], bots: {}, log: [], videos: [], projects: [], settings: null, training: [], connected: false };

interface StateResponse {
  bots: { meta: BotMeta; state: BotState }[];
  log: LogEntry[];
  videos: VideoRecord[];
  projects: EditorProject[];
  settings: PublicSettings;
  training: { name: string; chars: number }[];
}

function sortVideos(v: VideoRecord[]) {
  return [...v].sort((a, b) => a.order - b.order);
}

function apply(s: LiveState, e: ServerEvent): LiveState {
  switch (e.type) {
    case "bot":
      return { ...s, bots: { ...s.bots, [e.bot.id]: e.bot } };
    case "log":
      return { ...s, log: [...s.log.slice(-199), e.entry] };
    case "video": {
      const others = s.videos.filter((v) => v.id !== e.video.id);
      return { ...s, videos: sortVideos([...others, e.video]) };
    }
    case "video.removed":
      return { ...s, videos: s.videos.filter((v) => v.id !== e.id) };
    case "project": {
      const others = s.projects.filter((p) => p.id !== e.project.id);
      return { ...s, projects: [e.project, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    case "project.removed":
      return { ...s, projects: s.projects.filter((p) => p.id !== e.id) };
    case "settings":
      return { ...s, settings: e.settings };
    case "training":
      return { ...s, training: e.training };
  }
}

/** Everything the server knows, kept live over Server-Sent Events. */
export function useLive(): LiveState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<LiveState>(empty);

  const refresh = useCallback(async () => {
    const r = await api.get<StateResponse>("/api/state");
    setState((s) => ({
      ...s,
      metas: r.bots.map((b) => b.meta),
      bots: Object.fromEntries(r.bots.filter((b) => b.state).map((b) => [b.meta.id, b.state])),
      log: r.log,
      videos: sortVideos(r.videos),
      projects: r.projects,
      settings: r.settings,
      training: r.training,
    }));
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        void refresh().catch(() => undefined);
      };
      es.onmessage = (m) => setState((s) => apply(s, JSON.parse(m.data)));
      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es?.close();
        retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [refresh]);

  return { ...state, refresh };
}
