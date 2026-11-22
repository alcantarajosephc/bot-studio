import { useEffect, useRef } from "react";
import type { LiveState } from "../lib/live";
import { drawSprite, type Face } from "../../../shared/sprites";
import { Sprite, faceFor } from "../components/Sprite";
import { APP_NAME } from "../../../shared/brand";

// Art is drawn at a small "pixel" resolution, then scaled up crisp.
const W = 420;
const H = 270;
const S = 3; // screen pixels per art pixel
const TW = 24; // tile width
const TH = 12; // tile height
const COLS = 12;
const ROWS = 10;
const OX = W / 2 + 6;
const OY = 58;
const WALL = 46;

const iso = (x: number, y: number) => ({ x: OX + ((x - y) * TW) / 2, y: OY + ((x + y) * TH) / 2 });

/** Desk spots. Each bot works at its own desk; new bots without a desk share the spare one. */
const DESKS: Record<string, { x: number; y: number }> = {
  thumbnail: { x: 1, y: 2 },
  caption: { x: 4, y: 2 },
  scheduler: { x: 7, y: 2 },
  manager: { x: 9.6, y: 4.2 },
  posting: { x: 1, y: 5.4 },
  editor: { x: 4, y: 5.4 },
  revision: { x: 7, y: 5.4 },
};
const SPARE_DESK = { x: 1, y: 8 };
const LOUNGE = [
  { x: 10.4, y: 6.6, what: "coffee" },
  { x: 8.7, y: 8.9, what: "sofa" },
  { x: 9.7, y: 8.9, what: "sofa" },
  { x: 11.2, y: 9.2, what: "arcade" },
  { x: 3.2, y: 0.9, what: "window" },
  { x: 6.2, y: 8.6, what: "plant" },
  { x: 5.2, y: 4.2, what: "chat" },
];

interface Walker {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  nextWander: number;
  say: string;
  sayUntil: number;
  phase: number;
}

type G = CanvasRenderingContext2D;

function poly(g: G, pts: { x: number; y: number }[], fill: string, stroke?: string) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 0.6;
    g.stroke();
  }
}

const up = (p: { x: number; y: number }, h: number) => ({ x: p.x, y: p.y - h });

/** An isometric box: x,y = back corner in tiles, w along x, d along y, h in pixels. */
function box(g: G, x: number, y: number, w: number, d: number, h: number, top: string, left: string, right: string) {
  const a = iso(x, y), b = iso(x + w, y), c = iso(x + w, y + d), e = iso(x, y + d);
  poly(g, [e, c, up(c, h), up(e, h)], left, "#00000033");
  poly(g, [b, c, up(c, h), up(b, h)], right, "#00000033");
  poly(g, [up(a, h), up(b, h), up(c, h), up(e, h)], top, "#00000022");
}

function drawRoom(g: G, now: Date, scheduled: number) {
  g.fillStyle = "#0d0e13";
  g.fillRect(0, 0, W, H);

  // back walls
  const o = iso(0, 0), xr = iso(COLS, 0), yl = iso(0, ROWS);
  poly(g, [o, xr, up(xr, WALL), up(o, WALL)], "#30407a");
  poly(g, [o, yl, up(yl, WALL), up(o, WALL)], "#283669");
  poly(g, [up(o, WALL), up(xr, WALL), up(xr, WALL + 3), up(o, WALL + 3)], "#5468b0");
  poly(g, [up(o, WALL), up(yl, WALL), up(yl, WALL + 3), up(o, WALL + 3)], "#4a5ca0");
  // windows on the right wall
  for (const wx of [2.2, 5.2]) {
    const p = iso(wx, 0), q = iso(wx + 2, 0);
    poly(g, [up(p, 12), up(q, 12), up(q, 34), up(p, 34)], "#9fd3ff");
    poly(g, [up(p, 12), up(q, 12), up(q, 15), up(p, 15)], "#cfeaff");
    g.strokeStyle = "#30407a";
    g.lineWidth = 1;
    const m = iso(wx + 1, 0);
    g.beginPath();
    g.moveTo(m.x, m.y - 12);
    g.lineTo(m.x, m.y - 34);
    g.stroke();
  }
  // whiteboard on the left wall with the schedule count
  {
    const p = iso(0, 2.2), q = iso(0, 5.4);
    poly(g, [up(p, 14), up(q, 14), up(q, 34), up(p, 34)], "#f3f4f8", "#9aa3c0");
    g.fillStyle = "#30407a";
    g.font = "bold 5px monospace";
    g.save();
    g.translate((p.x + q.x) / 2, (p.y + q.y) / 2 - 26);
    g.transform(1, 0.5, 0, 1, 0, 0);
    g.textAlign = "center";
    g.fillText("SCHEDULED", 0, 0);
    g.font = "bold 9px monospace";
    g.fillStyle = "#e0457b";
    g.fillText(String(scheduled), 0, 10);
    g.restore();
  }
  // wall clock
  {
    const c = iso(9.8, 0);
    const cx = c.x, cy = c.y - 28;
    g.fillStyle = "#f3f4f8";
    g.beginPath();
    g.ellipse(cx, cy, 6, 6.5, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#1b1d26";
    g.lineWidth = 0.8;
    const hA = ((now.getHours() % 12) / 12) * Math.PI * 2 - Math.PI / 2;
    const mA = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(hA) * 3, cy + Math.sin(hA) * 3);
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(mA) * 4.6, cy + Math.sin(mA) * 4.6);
    g.stroke();
  }

  // pink carpet floor
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      const a = iso(x, y), b = iso(x + 1, y), c = iso(x + 1, y + 1), d = iso(x, y + 1);
      poly(g, [a, b, c, d], (x + y) % 2 ? "#e0618a" : "#d45780");
      if ((x * 7 + y * 3) % 5 === 0) {
        const m = iso(x + 0.5, y + 0.5);
        g.fillStyle = "#ef7a9f";
        g.fillRect(m.x - 1, m.y - 0.5, 2, 1);
      }
    }
  }
  // lounge rug
  {
    const a = iso(8.2, 7.2), b = iso(11.8, 7.2), c = iso(11.8, 9.8), d = iso(8.2, 9.8);
    poly(g, [a, b, c, d], "#3a9ec9");
    const a2 = iso(8.5, 7.5), b2 = iso(11.5, 7.5), c2 = iso(11.5, 9.5), d2 = iso(8.5, 9.5);
    poly(g, [a2, b2, c2, d2], "#4bb3dd");
  }
}

interface Prop {
  depth: number;
  draw: (g: G) => void;
}

function deskProps(working: Record<string, boolean>, deskOf: Record<string, { x: number; y: number }>): Prop[] {
  const props: Prop[] = [];
  for (const [id, d] of Object.entries(deskOf)) {
    props.push({
      depth: d.x + d.y + 1.5,
      draw: (g) => {
        box(g, d.x, d.y, 2, 0.9, 9, "#b07a52", "#7d5236", "#93623f");
        // monitor
        const on = working[id];
        box(g, d.x + 0.55, d.y + 0.1, 0.9, 0.18, 10, "#1b1d26", on ? "#3cc78a" : "#2a2d3a", "#14161d");
        // keyboard
        const k = iso(d.x + 1, d.y + 0.65);
        g.fillStyle = "#e8e9ee";
        g.fillRect(k.x - 3, k.y - 9.5, 6, 1.2);
      },
    });
  }
  return props;
}

function loungeProps(): Prop[] {
  return [
    // coffee machine + counter
    { depth: 11 + 5.4 + 1, draw: (g) => { box(g, 11, 5.4, 1, 1, 12, "#9aa3b5", "#5c6478", "#737c91"); box(g, 11.25, 5.5, 0.5, 0.35, 6, "#1b1d26", "#2a2d3a", "#3cc78a"); } },
    // sofa: seat + back
    { depth: 8.4 + 9.4 + 1, draw: (g) => { box(g, 8.3, 9.3, 2.6, 0.7, 6, "#f58a3a", "#b85f20", "#d4732b"); box(g, 8.3, 9.75, 2.6, 0.25, 12, "#f9a463", "#b85f20", "#d4732b"); } },
    // coffee table
    { depth: 9 + 8 + 0.5, draw: (g) => box(g, 9, 7.9, 1.4, 0.7, 4, "#f3f4f8", "#a9b0c4", "#c9cfdd") },
    // arcade cabinet
    {
      depth: 11.2 + 8.2 + 1,
      draw: (g) => {
        box(g, 11.2, 8.2, 0.8, 0.8, 24, "#7a4de0", "#4a2aa0", "#5e36c4");
        const s = iso(11.2, 8.6);
        g.fillStyle = (Math.floor(performance.now() / 300) % 2) ? "#5ef2c2" : "#ffd21f";
        g.fillRect(s.x - 4, s.y - 19, 5, 4);
      },
    },
    // plants
    { depth: 0.3 + 8.8 + 0.6, draw: (g) => { box(g, 0.3, 8.8, 0.6, 0.6, 5, "#c45f1c", "#8a4214", "#a5511a"); const p = iso(0.6, 9.1); g.fillStyle = "#3cc78a"; g.beginPath(); g.ellipse(p.x, p.y - 11, 5, 6, 0, 0, Math.PI * 2); g.fill(); } },
    { depth: 6.6 + 9.2 + 0.6, draw: (g) => { box(g, 6.6, 9.2, 0.6, 0.6, 5, "#c45f1c", "#8a4214", "#a5511a"); const p = iso(6.9, 9.5); g.fillStyle = "#2fae78"; g.beginPath(); g.ellipse(p.x, p.y - 11, 4.5, 6, 0, 0, Math.PI * 2); g.fill(); } },
    // shelf against left wall
    { depth: 0.2 + 1, draw: (g) => box(g, 0.05, 0.2, 0.5, 1.4, 22, "#6b4a33", "#4a3222", "#5a3e2b") },
  ];
}

function bubble(g: G, x: number, y: number, text: string, tone: "work" | "idle" | "off" | "error") {
  g.font = "600 13px Inter, sans-serif";
  const w = Math.min(g.measureText(text).width, 260) + 14;
  const h = 20;
  const bx = Math.round(x - w / 2), by = Math.round(y - h);
  g.fillStyle = tone === "error" ? "#ffdde2" : tone === "off" ? "#d9dbe2" : "#ffffff";
  g.strokeStyle = tone === "work" ? "#3cc78a" : "#1b1d26";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(bx, by, w, h, 7);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(x - 4, by + h);
  g.lineTo(x, by + h + 6);
  g.lineTo(x + 4, by + h);
  g.fill();
  g.fillStyle = "#1b1d26";
  g.textBaseline = "middle";
  g.textAlign = "left";
  let t = text;
  while (g.measureText(t).width > 260 && t.length > 4) t = t.slice(0, -2);
  if (t !== text) t = `${t.trimEnd()}…`;
  g.fillText(t, bx + 7, by + h / 2 + 0.5);
}

export function OfficeView({ live, onOpenBot }: { live: LiveState; onOpenBot: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const walkers = useRef<Record<string, Walker>>({});
  const hits = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([]);

  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext("2d")!;
    let raf = 0;
    let last = performance.now();

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const L = liveRef.current;
      const metas = L.metas;
      const deskOf: Record<string, { x: number; y: number }> = {};
      metas.forEach((m) => (deskOf[m.id] = DESKS[m.id] ?? SPARE_DESK));

      // update walkers
      for (const m of metas) {
        const st = L.bots[m.id]?.status ?? "idle";
        const desk = deskOf[m.id];
        const seat = { x: desk.x + 1, y: desk.y + 1.35 };
        let w = walkers.current[m.id];
        if (!w) {
          w = walkers.current[m.id] = { id: m.id, x: seat.x, y: seat.y, tx: seat.x, ty: seat.y, nextWander: t + 3000 + Math.random() * 6000, say: "", sayUntil: 0, phase: Math.random() * 10 };
        }
        if (st === "working" || st === "off" || st === "error") {
          w.tx = seat.x;
          w.ty = seat.y;
        } else if (t > w.nextWander) {
          const spot = Math.random() < 0.35 ? { ...seat, what: "desk" } : LOUNGE[Math.floor(Math.random() * LOUNGE.length)];
          w.tx = spot.x + (Math.random() - 0.5) * 0.4;
          w.ty = spot.y + (Math.random() - 0.5) * 0.4;
          w.nextWander = t + 7000 + Math.random() * 9000;
          if (Math.random() < 0.55) {
            w.say = m.idleLines[Math.floor(Math.random() * m.idleLines.length)] ?? "";
            w.sayUntil = t + 3200;
          }
        }
        const dx = w.tx - w.x, dy = w.ty - w.y;
        const dist = Math.hypot(dx, dy);
        const step = 2.2 * dt;
        if (dist > step) {
          w.x += (dx / dist) * step;
          w.y += (dy / dist) * step;
        } else {
          w.x = w.tx;
          w.y = w.ty;
        }
      }

      // draw art layer at low res
      g.setTransform(S, 0, 0, S, 0, 0);
      g.imageSmoothingEnabled = false;
      const scheduled = L.videos.filter((v) => v.stage === "scheduled").length;
      drawRoom(g, new Date(), scheduled);
      const working = Object.fromEntries(metas.map((m) => [m.id, L.bots[m.id]?.status === "working"]));
      const props: Prop[] = [...deskProps(working, deskOf), ...loungeProps()];
      const botProps: (Prop & { id: string; sx: number; sy: number })[] = [];
      for (const m of metas) {
        const w = walkers.current[m.id];
        if (!w) continue;
        const st = L.bots[m.id]?.status ?? "idle";
        const p = iso(w.x, w.y);
        const moving = Math.hypot(w.tx - w.x, w.ty - w.y) > 0.01;
        const bobY = moving ? (Math.floor(t / 140 + w.phase) % 2) : st === "working" ? (Math.floor(t / 220 + w.phase) % 2) * 0.6 : 0;
        const blink = st === "idle" && Math.floor(t / 100 + w.phase * 37) % 45 === 0;
        const face: Face = blink ? "blink" : faceFor(st);
        const sx = p.x - 8, sy = p.y - 17 - bobY;
        botProps.push({
          id: m.id,
          sx,
          sy,
          depth: w.x + w.y + 0.9,
          draw: (gg) => {
            gg.fillStyle = "#00000040";
            gg.beginPath();
            gg.ellipse(p.x, p.y - 1, 6, 2.5, 0, 0, Math.PI * 2);
            gg.fill();
            drawSprite(gg, m.color, face, sx, sy, 1);
          },
        });
      }
      [...props, ...botProps].sort((a, b) => a.depth - b.depth).forEach((pr) => pr.draw(g));

      // text layer at full res
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = true;
      hits.current = [];
      for (const bp of botProps) {
        const m = metas.find((x) => x.id === bp.id)!;
        const w = walkers.current[bp.id];
        const st = L.bots[bp.id]?.status ?? "idle";
        const cx = (bp.sx + 8) * S;
        const top = bp.sy * S;
        hits.current.push({ id: bp.id, x: bp.sx * S, y: top, w: 16 * S, h: 18 * S });
        // name tag
        g.font = "700 11px Inter, sans-serif";
        const nw = g.measureText(m.name).width + 10;
        g.fillStyle = "rgba(15,16,20,0.82)";
        g.beginPath();
        g.roundRect(cx - nw / 2, top + 18 * S + 2, nw, 16, 5);
        g.fill();
        g.fillStyle = "#fff";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(m.name, cx, top + 18 * S + 10);
        // pin + bubble
        const detail = L.bots[bp.id]?.detail ?? "";
        if (st === "working") {
          const rise = (t / 18) % 14;
          g.fillStyle = "#ffd21f";
          g.save();
          g.translate(cx, top - 10 - rise);
          g.rotate(Math.PI / 4);
          g.fillRect(-4, -4, 8, 8);
          g.restore();
          bubble(g, cx, top - 18, detail || m.workLines[0], "work");
        } else if (st === "error") {
          bubble(g, cx, top - 6, "Something went wrong. Click me.", "error");
        } else if (st === "off") {
          bubble(g, cx, top - 6, detail || "Not connected yet", "off");
        } else if (w && t < w.sayUntil && w.say) {
          bubble(g, cx, top - 6, w.say, "idle");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const hit = hits.current.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    if (hit) onOpenBot(hit.id);
  };

  return (
    <div className="office">
      <div className="office-title">{APP_NAME} office · busy bots stay at their desks, free ones wander the room</div>
      <canvas ref={canvas} width={W * S} height={H * S} onClick={onClick} style={{ width: W * S, cursor: "pointer" }} />
      <div className="office-legend">
        {live.metas.map((m) => (
          <span key={m.id} className="who" onClick={() => onOpenBot(m.id)}>
            <Sprite color={m.color} status={live.bots[m.id]?.status} size={20} />
            {m.name}
          </span>
        ))}
      </div>
    </div>
  );
}
