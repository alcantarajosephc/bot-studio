import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { ReactFlow, Background, Handle, Position, useNodesInitialized, useReactFlow, type Edge, type Node, type NodeProps, type OnNodesChange } from "@xyflow/react";
import type { BotMeta, BotState } from "../../../shared/types";
import type { LiveState } from "../lib/live";
import { uploadVideos } from "../lib/api";
import { Sprite } from "../components/Sprite";
import { BotLog, StatusRows } from "../components/BotLog";
import { fmtSlot } from "../lib/format";

type Kind = "drop" | "thumbnail" | "caption" | "scheduler" | "posting" | "manager" | "editor" | "revision";
type BotNodeData = { kind: Kind; live: LiveState; meta?: BotMeta; state?: BotState; onOpen: (id: string) => void };
type BotNode = Node<BotNodeData, "bot">;

const DEFAULT_POS: Record<Kind, { x: number; y: number }> = {
  drop: { x: 0, y: 40 },
  thumbnail: { x: 270, y: 40 },
  caption: { x: 540, y: 40 },
  scheduler: { x: 810, y: 40 },
  posting: { x: 540, y: 300 },
  manager: { x: 810, y: 300 },
  editor: { x: 0, y: 520 },
  revision: { x: 270, y: 520 },
};
const POS_KEY = "bots.canvas.positions";

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return { ...DEFAULT_POS, ...JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_POS };
  }
}
function savePositions(p: Record<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    // private mode etc.
  }
}

const ICON: Record<Kind, string> = { drop: "📥", thumbnail: "🖼️", caption: "📝", scheduler: "📅", posting: "📤", manager: "🧭", editor: "🎬", revision: "🔁" };

function DropBody({ live }: { live: LiveState }) {
  const [over, setOver] = useState(false);
  const [msg, setMsg] = useState("");
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    setMsg(`Uploading ${files.length}...`);
    try {
      const r = await uploadVideos(files);
      setMsg(`Added ${r.added.length}`);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const recent = live.videos.slice(-3);
  return (
    <>
      <div
        className={`drop-zone nodrag ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={(e) => e.stopPropagation()}
      >
        Drop videos here
        <br />
        <span className="hint">{msg || "or into data/inbox"}</span>
      </div>
      <div className="chips">
        {recent.map((v) => (
          <span key={v.id} className={`chip ${v.stage === "error" ? "chip-red" : v.stage === "scheduled" ? "chip-green" : ""}`} title={v.error ?? v.stage}>
            {v.originalName}
          </span>
        ))}
        {live.videos.length > 3 ? <span className="chip">+{live.videos.length - 3}</span> : null}
      </div>
    </>
  );
}

function NodeBody({ data }: { data: BotNodeData }) {
  const { kind, live } = data;
  switch (kind) {
    case "drop":
      return <DropBody live={live} />;
    case "thumbnail": {
      const withThumb = live.videos.filter((v) => v.thumbnail).slice(-4);
      return withThumb.length ? (
        <div className="thumbs">
          {withThumb.map((v) => (
            <img key={v.id} src={`/media/thumbs/${v.thumbnail!.file}`} alt="" />
          ))}
        </div>
      ) : null;
    }
    case "caption": {
      const last = [...live.videos].reverse().find((v) => v.caption);
      return last ? (
        <div className="chips">
          {last.caption!.keywords.slice(0, 4).map((k) => (
            <span key={k} className="chip chip-yellow">{k}</span>
          ))}
        </div>
      ) : null;
    }
    case "scheduler": {
      const tz = live.settings?.schedule.timezone ?? "Asia/Manila";
      const next = live.videos.filter((v) => v.schedule && v.stage === "scheduled").map((v) => v.schedule!.at).sort().slice(0, 4);
      return next.length ? (
        <div className="slots">
          {next.map((at) => (
            <span key={at} className="slot">{fmtSlot(at, tz)}</span>
          ))}
        </div>
      ) : null;
    }
    case "posting":
      return (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="platforms">
            <span className="platform" style={{ background: "#111", border: "1px solid #444" }}>TT</span>
            <span className="platform" style={{ background: "#1877f2" }}>f</span>
            <span className="platform" style={{ background: "#d62976" }}>IG</span>
            <span className="platform" style={{ background: "#ff0000" }}>▶</span>
          </div>
          <span className="chip">not connected</span>
        </div>
      );
    case "editor": {
      const p = live.projects[0];
      return p ? <span className="node-detail">{p.name} · v{p.versions.length}</span> : null;
    }
    case "revision": {
      const open = live.projects.reduce((n, p) => n + p.notes.filter((x) => !x.done).length, 0);
      return <span className="node-detail">{open} open note{open === 1 ? "" : "s"}</span>;
    }
    default:
      return null;
  }
}

function BotNodeView({ data }: NodeProps<BotNode>) {
  const { kind, meta, state } = data;
  const status = state?.status ?? "idle";
  const title = kind === "drop" ? "Drop videos" : (meta?.name ?? kind);
  const sub = kind === "drop" ? "Input" : (meta?.tagline ?? "");
  return (
    <div className={`node ${kind === "drop" ? "" : status}`} style={{ position: "relative" }}>
      {kind !== "drop" && (status === "working" || status === "error") ? <span className={`status-tag ${status}`}>{status === "working" ? "Working" : "Error"}</span> : null}
      <Handle type="target" position={Position.Left} id="l" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="t" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Right} id="rt" style={{ opacity: 0 }} />
      <div className="node-head">
        <span className="node-icon">{ICON[kind]}</span>
        <div>
          <div className="node-title">{title}</div>
          <div className="node-sub">{sub}</div>
        </div>
        {meta ? <Sprite color={meta.color} status={status} size={30} /> : null}
      </div>
      <div className="node-body">
        <NodeBody data={data} />
        {kind !== "drop" && state?.detail && status !== "idle" ? <div className="node-detail" title={state.detail}>{state.detail}</div> : null}
      </div>
      <Handle type="source" position={Position.Right} id="r" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="b" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="ls" style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { bot: BotNodeView };

/** Fit the graph once the nodes have real sizes (and again when the window resizes). */
function FitWhenReady() {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!ready) return;
    void fitView({ padding: 0.12, maxZoom: 1.1 });
    const onResize = () => void fitView({ padding: 0.12, maxZoom: 1.1 });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ready, fitView]);
  return null;
}

const EDGES: [Kind, Kind, string, string][] = [
  ["drop", "thumbnail", "r", "l"],
  ["thumbnail", "caption", "r", "l"],
  ["caption", "scheduler", "r", "l"],
  ["scheduler", "manager", "b", "t"],
  ["manager", "posting", "ls", "rt"],
  ["editor", "revision", "r", "l"],
];

export function CanvasView({ live, onOpenBot }: { live: LiveState; onOpenBot: (id: string) => void }) {
  const [rfNodes, setRfNodes] = useState<BotNode[]>(() => {
    const pos = loadPositions();
    return (Object.keys(DEFAULT_POS) as Kind[]).map((kind) => ({ id: kind, type: "bot", position: pos[kind] ?? DEFAULT_POS[kind], data: { kind } as BotNodeData }));
  });
  const metaById = useMemo(() => Object.fromEntries(live.metas.map((m) => [m.id, m])), [live.metas]);

  const open = useCallback((kind: string) => onOpenBot(kind === "drop" ? "library" : kind), [onOpenBot]);

  // React Flow owns position + size; we only inject live data at render time.
  const nodes: BotNode[] = useMemo(
    () => rfNodes.map((n) => ({ ...n, data: { kind: n.id as Kind, live, meta: metaById[n.id], state: live.bots[n.id], onOpen: open } })),
    [rfNodes, live, metaById, open],
  );

  const edges: Edge[] = EDGES.map(([s, t, sh, th]) => {
    const active = live.bots[s]?.status === "working" || live.bots[t]?.status === "working";
    return {
      id: `${s}-${t}`,
      source: s,
      target: t,
      sourceHandle: sh,
      targetHandle: th,
      animated: active,
      style: { stroke: active ? "#3cc78a" : t === "posting" ? "#5a4a2a" : "#4a4d5a", strokeWidth: 2, strokeDasharray: t === "posting" ? "5 5" : undefined },
    };
  });

  const onNodesChange: OnNodesChange<BotNode> = useCallback((changes) => {
    setRfNodes((prev) => {
      const next = changes.applyTo(prev);
      const dropped = prev.some((n) => changes.getForNode(n.id).some((c) => c.type === "position" && !c.dragging));
      if (dropped) savePositions(Object.fromEntries(next.map((n) => [n.id, n.position])));
      return next;
    });
  }, []);

  useEffect(() => {
    const prevent = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  return (
    <div className="canvas-wrap">
      <div className="flow">
        <div className="flow-head">
        <div className="crumb">Pipeline · videos flow left to right · editing lane at the bottom</div>
        <div className="flow-tools">
          <button
            className="btn btn-sm"
            onClick={() => {
              setRfNodes((prev) => prev.map((n) => ({ ...n, position: DEFAULT_POS[n.id as Kind] })));
              savePositions({ ...DEFAULT_POS });
            }}
          >
            ⊞ Tidy up
          </button>
        </div>
        </div>
        <div className="flow-area">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_, n) => open(n.id)} minZoom={0.4} maxZoom={1.6} proOptions={{ hideAttribution: true }}>
          <Background color="#2a2c35" gap={22} />
          <FitWhenReady />
        </ReactFlow>
        </div>
      </div>
      <BotLog live={live} />
      <StatusRows live={live} onOpen={onOpenBot} />
    </div>
  );
}
