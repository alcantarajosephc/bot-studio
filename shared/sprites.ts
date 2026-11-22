// Original pixel-art bots, drawn in code. 16x16, one char per pixel.
// Swap the art by editing these grids or the palettes; nothing else needs to change.

export type Face = "idle" | "work" | "error" | "off" | "blink";

const BODY = [
  ".......aa.......",
  ".......oo.......",
  "..oooooooooooo..",
  ".ohhhhhhhhhhhbo.",
  ".ohkkkkkkkkkkbo.",
  ".ohkkkkkkkkkkbo.",
  ".ohkkkkkkkkkkbo.",
  ".ohkkkkkkkkkkbo.",
  ".ohkkkkkkkkkkbo.",
  ".obbbbbbbbbbbso.",
  "..ossssssssssoo.",
  "....obbbbbbso...",
  "...obhbbbbbbso..",
  "...obbbbbbbbso..",
  "....oo....oo....",
  "................",
];

/** Face rows (4..8) drawn over the black screen. 'e' = eye, 'm' = mouth, 'x' = error mark. */
const FACES: Record<Face, string[]> = {
  idle: [
    ".ohkkkkkkkkkkbo.",
    ".ohkkekkkkekkbo.",
    ".ohkkekkkkekkbo.",
    ".ohkkkkmmkkkkbo.",
    ".ohkkkkkkkkkkbo.",
  ],
  blink: [
    ".ohkkkkkkkkkkbo.",
    ".ohkkkkkkkkkkbo.",
    ".ohkeekkkeekkbo.",
    ".ohkkkkmmkkkkbo.",
    ".ohkkkkkkkkkkbo.",
  ],
  work: [
    ".ohkkkkkkkkkkbo.",
    ".ohkkekkkkekkbo.",
    ".ohkekekkekekbo.",
    ".ohkkkkkkkkkkbo.",
    ".ohkkkmmmmkkkbo.",
  ],
  error: [
    ".ohkkkkkkkkkkbo.",
    ".ohkxkxkkxkxkbo.",
    ".ohkkxkkkkxkkbo.",
    ".ohkxkxkkxkxkbo.",
    ".ohkkkkkkkkkkbo.",
  ],
  off: [
    ".ohkkkkkkkkkkbo.",
    ".ohkkkkkkkkkkbo.",
    ".ohkeekkkeekkbo.",
    ".ohkkkkkkkkkkbo.",
    ".ohkkkkkkkkkkbo.",
  ],
};

export interface Palette {
  o: string; // outline
  h: string; // highlight
  b: string; // base
  s: string; // shade
  a: string; // antenna light
}

export const PALETTES: Record<string, Palette> = {
  gray: { o: "#1b1d26", h: "#e9ecf2", b: "#b9bfcc", s: "#868c9c", a: "#ff5d73" },
  blue: { o: "#14193a", h: "#8fb8ff", b: "#4f7cf0", s: "#3253b8", a: "#ffd21f" },
  purple: { o: "#1d1433", h: "#c9a6ff", b: "#9064e8", s: "#6741b4", a: "#5ef2c2" },
  green: { o: "#0f2a22", h: "#8ff0bf", b: "#3cc78a", s: "#259464", a: "#ffd21f" },
  pink: { o: "#3a1328", h: "#ffb3d6", b: "#f2689f", s: "#c24479", a: "#8fd8ff" },
  orange: { o: "#3a1f0d", h: "#ffc68f", b: "#f58a3a", s: "#c45f1c", a: "#8fd8ff" },
  yellow: { o: "#3a300d", h: "#fff09a", b: "#f5c518", s: "#c4980f", a: "#ff5d73" },
};

const SCREEN = { k: "#0b0d12", e: "#7ff7ff", m: "#7ff7ff", x: "#ff5d73" };

export const SPRITE_SIZE = 16;

/** The 16 rows for a bot face. Exported for tests. */
export function spriteRows(face: Face): string[] {
  return BODY.map((row, i) => (i >= 4 && i <= 8 ? FACES[face][i - 4] : row));
}

/** Pixel color at (x, y), or null for transparent. */
export function spritePixels(color: string, face: Face): (string | null)[][] {
  const pal = PALETTES[color] ?? PALETTES.gray;
  const dim = face === "off";
  return spriteRows(face).map((row) =>
    [...row].map((ch) => {
      if (ch === ".") return null;
      if (ch in SCREEN) return ch === "e" && dim ? "#3a4250" : SCREEN[ch as keyof typeof SCREEN];
      if (ch === "a" && dim) return "#555b66";
      return pal[ch as keyof Palette] ?? null;
    }),
  );
}

/** Draw a bot onto a 2D canvas at (x, y), `scale` screen pixels per art pixel. */
export function drawSprite(g: CanvasRenderingContext2D, color: string, face: Face, x: number, y: number, scale = 1): void {
  const px = spritePixels(color, face);
  for (let r = 0; r < px.length; r++) {
    for (let c = 0; c < px[r].length; c++) {
      const col = px[r][c];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), Math.ceil(scale), Math.ceil(scale));
    }
  }
}
