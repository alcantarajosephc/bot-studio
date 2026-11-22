import type { EditPlan, Timeline, Word } from "../../../shared/types.ts";

export interface CompileOptions {
  duration: number;
  fps: number;
  width: number;
  height: number;
  src: string;
  assetUrl: (asset: string) => string;
  /** Known asset file names. Inserts naming anything else are dropped. */
  assets?: string[];
}

/** Breathing room left at each side of a cut silence. */
const PAD = 0.12;
/** Don't bother cutting gaps shorter than this. */
const MIN_CUT = 0.25;
const MIN_PIECE = 0.1;
const LEAD_IN = 0.25;
const TAIL_OUT = 0.5;
const MAX_CAPTION_WORDS = 2;
const MAX_CAPTION_CHARS = 16;
const CAPTION_GAP_BREAK = 0.35;

type Range = { start: number; end: number };
type IndexedWord = Word & { index: number };

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function validRange(words: Word[], from: number, to: number): [number, number] | null {
  if (!words.length || !Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || from >= words.length) return null;
  const end = Math.min(Math.max(to, from), words.length - 1);
  return [from, end];
}

function cleanCaptionWord(w: string): string {
  return w.replace(/^[\s"'“”‘’(\[,.;:…-]+/, "").replace(/[\s"'“”‘’)\],.;:…-]+$/, "").toUpperCase();
}

/** Group words into short punchy captions (1-2 words), breaking on punctuation and pauses. */
export function chunkCaptions(words: IndexedWord[], breakBefore: Set<number> = new Set()): IndexedWord[][] {
  const groups: IndexedWord[][] = [];
  let cur: IndexedWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const chars = cur.reduce((n, x) => n + cleanCaptionWord(x.word).length + 1, 0) + cleanCaptionWord(w.word).length;
    if (cur.length && (cur.length >= MAX_CAPTION_WORDS || chars > MAX_CAPTION_CHARS || breakBefore.has(w.index))) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
    const next = words[i + 1];
    const endsSentence = /[,.!?;:…]["'”’)]*$/.test(w.word);
    if (endsSentence || !next || next.start - w.end > CAPTION_GAP_BREAK) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

/**
 * Turn Claude's edit plan (word indices) into an exact frame timeline for Remotion.
 * All the fiddly timing lives here so it can be tested without rendering.
 */
export function compileTimeline(words: Word[], silences: Range[], plan: EditPlan, o: CompileOptions): Timeline {
  const D = o.duration;
  const fps = o.fps;

  // 1. What to cut: long silences (with padding) + words Claude removed.
  const removals: Range[] = [];
  for (const s of silences) {
    const start = s.start <= 0.01 ? 0 : s.start + PAD;
    const end = s.end >= D - 0.01 ? D : s.end - PAD;
    if (end - start >= MIN_CUT) removals.push({ start, end });
  }
  if (words.length) {
    // Dead air before the first word and after the last, even if there's background noise.
    const lead = words[0].start - LEAD_IN;
    if (lead >= MIN_CUT) removals.push({ start: 0, end: lead });
    const tail = words.at(-1)!.end + TAIL_OUT;
    if (D - tail >= MIN_CUT) removals.push({ start: tail, end: D });
  }
  for (const r of plan.removeWordRanges) {
    const v = validRange(words, r.fromWord, r.toWord);
    if (!v) continue;
    const [a, b] = v;
    const start = Math.max(words[a - 1]?.end ?? 0, words[a].start - 0.04);
    const end = Math.min(words[b + 1]?.start ?? D, words[b].end + 0.04);
    removals.push({ start, end });
  }
  const cuts = mergeRanges(removals.map((r) => ({ start: Math.max(0, r.start), end: Math.min(D, r.end) })));

  // 2. What's left.
  let keeps: Range[] = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start - t >= MIN_PIECE) keeps.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (D - t >= MIN_PIECE) keeps.push({ start: t, end: D });

  // 3. Split at title-card and zoom boundaries.
  const cards = plan.titleCards
    .filter((c) => words[c.beforeWord])
    .map((c) => ({ at: Math.max(0, words[c.beforeWord].start - 0.02), text: c.text.toUpperCase(), seconds: Math.min(Math.max(c.seconds, 0.5), 4) }))
    .sort((a, b) => a.at - b.at);
  const zooms = plan.zooms
    .map((z) => {
      const v = validRange(words, z.fromWord, z.toWord);
      return v ? { start: Math.max(0, words[v[0]].start - 0.02), end: Math.min(D, words[v[1]].end + 0.04), scale: Math.min(Math.max(z.scale, 1), 1.6) } : null;
    })
    .filter((z): z is NonNullable<typeof z> => Boolean(z));
  const splitPoints = [...cards.map((c) => c.at), ...zooms.flatMap((z) => [z.start, z.end])];
  for (const p of splitPoints) {
    keeps = keeps.flatMap((k) =>
      p - k.start > 0.04 && k.end - p > 0.04 ? [{ start: k.start, end: p }, { start: p, end: k.end }] : [k],
    );
  }

  // 4. Lay pieces and cards out on the output timeline.
  const clips: Timeline["clips"] = [];
  const titleCards: Timeline["titleCards"] = [];
  const segs: { srcStart: number; srcEnd: number; outStart: number }[] = [];
  let outSec = 0;
  let cardIdx = 0;
  const placeCard = (c: (typeof cards)[number]) => {
    const dur = Math.round(c.seconds * fps);
    titleCards.push({ from: Math.round(outSec * fps), durationInFrames: dur, text: c.text });
    outSec += dur / fps;
  };
  for (const k of keeps) {
    while (cardIdx < cards.length && cards[cardIdx].at <= k.start + 0.05) placeCard(cards[cardIdx++]);
    const startF = Math.round(outSec * fps);
    const endF = Math.round((outSec + (k.end - k.start)) * fps);
    if (endF > startF) {
      const mid = (k.start + k.end) / 2;
      const zoom = zooms.filter((z) => mid >= z.start && mid <= z.end).at(-1)?.scale ?? 1;
      clips.push({ srcStart: k.start, srcEnd: k.end, from: startF, durationInFrames: endF - startF, zoom });
      segs.push({ srcStart: k.start, srcEnd: k.end, outStart: outSec });
    }
    outSec += k.end - k.start;
  }
  const durationInFrames = Math.max(1, Math.round(outSec * fps));

  const inKeep = (s: number) => segs.some((g) => s >= g.srcStart && s < g.srcEnd);
  const mapF = (s: number): number => {
    for (const g of segs) {
      if (s >= g.srcStart && s < g.srcEnd) return Math.round((g.outStart + (s - g.srcStart)) * fps);
    }
    const next = segs.find((g) => g.srcStart >= s);
    return next ? Math.round(next.outStart * fps) : durationInFrames;
  };
  const span = (from: number, to: number, minSec: number) => {
    const f = Math.min(from, durationInFrames - 1);
    const end = Math.min(Math.max(to, f + Math.round(minSec * fps)), durationInFrames);
    return { from: f, durationInFrames: Math.max(1, end - f) };
  };

  // 5. Captions from the words that survived the cut.
  const emphasis = new Set(plan.emphasisWords);
  const kept: IndexedWord[] = words
    .map((w, index) => ({ ...w, index }))
    .filter((w) => inKeep((w.start + w.end) / 2) && cleanCaptionWord(w.word).length > 0);
  const groups = chunkCaptions(kept, new Set(plan.titleCards.map((c) => c.beforeWord)));
  const captions: Timeline["captions"] = [];
  groups.forEach((g, i) => {
    const from = mapF(g[0].start);
    let end = Math.max(mapF(g.at(-1)!.end), from + 6);
    const nextFrom = groups[i + 1] ? mapF(groups[i + 1][0].start) : durationInFrames;
    if (nextFrom - end < Math.round(0.4 * fps)) end = nextFrom;
    end = Math.min(end, nextFrom, durationInFrames);
    const prev = captions.at(-1);
    const start = prev ? Math.max(from, prev.from + prev.durationInFrames) : from;
    if (end > start) {
      captions.push({ from: start, durationInFrames: end - start, words: g.map((w) => ({ text: cleanCaptionWord(w.word), highlight: emphasis.has(w.index) })) });
    }
  });

  // 6. Callouts and inserts.
  const callouts: Timeline["callouts"] = plan.callouts.flatMap((c) => {
    const v = validRange(words, c.fromWord, c.toWord);
    if (!v) return [];
    return [{ ...span(mapF(words[v[0]].start), mapF(words[v[1]].end), 1.2), text: c.text.toUpperCase(), position: c.position }];
  });
  const known = o.assets ? new Set(o.assets) : null;
  const inserts: Timeline["inserts"] = plan.inserts.flatMap((ins) => {
    const v = validRange(words, ins.fromWord, ins.toWord);
    if (!v || (known && !known.has(ins.asset))) return [];
    return [{ ...span(mapF(words[v[0]].start), mapF(words[v[1]].end), 1.5), src: o.assetUrl(ins.asset), label: ins.label ? ins.label.toUpperCase() : null }];
  });

  return { fps, width: o.width, height: o.height, durationInFrames, src: o.src, clips, titleCards, captions, callouts, inserts };
}

/** Seconds in the edited video -> seconds in the source (used to place revision notes). */
export function outputToSource(t: Timeline, sec: number): number {
  const f = sec * t.fps;
  for (const c of t.clips) {
    if (f >= c.from && f < c.from + c.durationInFrames) return c.srcStart + (f - c.from) / t.fps;
  }
  const next = t.clips.find((c) => c.from >= f);
  return next ? next.srcStart : (t.clips.at(-1)?.srcEnd ?? 0);
}
