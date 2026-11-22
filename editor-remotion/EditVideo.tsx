import { AbsoluteFill, Img, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { Timeline } from "../shared/types";
import { theme } from "./theme";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"], subsets: ["latin"] });
const FONT = `${fontFamily}, "Arial Black", Arial, sans-serif`;

/** Small pop-in used by captions, pills and cards. */
const usePop = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame, fps, config: { damping: 14, stiffness: 220, mass: 0.6 }, durationInFrames: 8 });
};

const Caption = ({ words }: { words: Timeline["captions"][number]["words"] }) => {
  const pop = usePop();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", top: `${theme.captionY * 100}%` }}>
      <div
        style={{
          transform: `scale(${0.85 + 0.15 * pop})`,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: theme.captionSize,
          lineHeight: 1.05,
          letterSpacing: 1,
          textAlign: "center",
          padding: "0 70px",
          color: theme.white,
          WebkitTextStroke: `${theme.stroke}px ${theme.ink}`,
          paintOrder: "stroke fill",
          textShadow: theme.textShadow,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ color: w.highlight ? theme.yellow : theme.white }}>
            {i ? " " : ""}
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Pill = ({ text, position, belowInsert }: { text: string; position: "top" | "middle"; belowInsert: boolean }) => {
  const pop = usePop();
  // When a screenshot card is on screen, labels sit under it instead of on top of it.
  const top = belowInsert ? "45%" : position === "top" ? "7%" : "30%";
  return (
    <AbsoluteFill style={{ alignItems: "center", top }}>
      <div
        style={{
          transform: `scale(${0.7 + 0.3 * pop})`,
          background: theme.yellow,
          color: theme.ink,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: position === "top" ? 46 : 58,
          padding: "14px 38px",
          borderRadius: 999,
          boxShadow: "0 8px 0 rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const isVideo = (src: string) => /\.(mp4|mov|webm|m4v)$/i.test(src.split("?")[0]);

const Insert = ({ src, label }: { src: string; label: string | null }) => {
  const pop = usePop();
  return (
    <AbsoluteFill style={{ alignItems: "center", top: "6%" }}>
      <div style={{ transform: `translateY(${(1 - pop) * -60}px) scale(${0.9 + 0.1 * pop})`, opacity: pop, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 900, maxHeight: 640, background: theme.white, padding: 12, borderRadius: 34, boxShadow: "0 20px 50px rgba(0,0,0,0.35)", overflow: "hidden" }}>
          {isVideo(src) ? (
            <OffthreadVideo src={src} muted style={{ width: "100%", maxHeight: 616, objectFit: "contain", borderRadius: 24, display: "block" }} />
          ) : (
            <Img src={src} style={{ width: "100%", maxHeight: 616, objectFit: "contain", borderRadius: 24, display: "block" }} />
          )}
        </div>
        {label ? (
          <div style={{ marginTop: -26, background: theme.yellow, color: theme.ink, fontFamily: FONT, fontWeight: 900, fontSize: 44, padding: "10px 34px", borderRadius: 999, border: `5px solid ${theme.ink}` }}>
            {label}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const TitleCard = ({ text }: { text: string }) => {
  const pop = usePop();
  return (
    <AbsoluteFill style={{ background: theme.card, justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: pop, transform: `scale(${0.9 + 0.1 * pop})`, color: theme.white, fontFamily: FONT, fontWeight: 900, fontSize: 92, textAlign: "center", padding: "0 80px" }}>{text}</div>
    </AbsoluteFill>
  );
};

export const EditVideo = ({ timeline }: { timeline: Timeline }) => {
  const t = timeline;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {t.clips.map((c, i) => (
        <Sequence key={`c${i}`} from={c.from} durationInFrames={c.durationInFrames} premountFor={15}>
          <AbsoluteFill style={{ transform: `scale(${c.zoom})`, transformOrigin: "50% 40%" }}>
            <OffthreadVideo src={t.src} trimBefore={Math.round(c.srcStart * t.fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </AbsoluteFill>
        </Sequence>
      ))}
      {t.inserts.map((x, i) => (
        <Sequence key={`i${i}`} from={x.from} durationInFrames={x.durationInFrames} layout="none">
          <Insert src={x.src} label={x.label} />
        </Sequence>
      ))}
      {t.callouts.map((x, i) => (
        <Sequence key={`p${i}`} from={x.from} durationInFrames={x.durationInFrames} layout="none">
          <Pill
            text={x.text}
            position={x.position}
            belowInsert={t.inserts.some((ins) => ins.from < x.from + x.durationInFrames && x.from < ins.from + ins.durationInFrames)}
          />
        </Sequence>
      ))}
      {t.captions.map((x, i) => (
        <Sequence key={`w${i}`} from={x.from} durationInFrames={x.durationInFrames} layout="none">
          <Caption words={x.words} />
        </Sequence>
      ))}
      {t.titleCards.map((x, i) => (
        <Sequence key={`t${i}`} from={x.from} durationInFrames={x.durationInFrames}>
          <TitleCard text={x.text} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
