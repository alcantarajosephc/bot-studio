import { useEffect, useRef, useState } from "react";
import { drawSprite, SPRITE_SIZE, type Face } from "../../../shared/sprites";
import type { BotStatus } from "../../../shared/types";

export function faceFor(status: BotStatus | undefined): Face {
  if (status === "working") return "work";
  if (status === "error") return "error";
  if (status === "off") return "off";
  return "idle";
}

/** A bot sprite at any size. Blinks now and then, bobs while working. */
export function Sprite({ color, status, size = 32 }: { color: string; status?: BotStatus; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [blink, setBlink] = useState(false);
  const face: Face = blink && status !== "error" && status !== "off" ? "blink" : faceFor(status);

  useEffect(() => {
    const t = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 2500 + Math.random() * 2500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    drawSprite(g, color, face, 0, 0, 1);
  }, [color, face]);

  return (
    <canvas
      ref={ref}
      width={SPRITE_SIZE}
      height={SPRITE_SIZE}
      className={`sprite ${status === "working" ? "bob" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
