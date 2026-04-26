import { useState, useEffect, useMemo } from "react";
import { useTheme } from "./theme.js";

// Monochrome player mark — shape + fill-style differentiates, not colour.
// glyph: circle | triangle | square | diamond | ring
// fillStyle: solid | ring | halftone | dotted
let __pmId = 0;
export function PlayerMark({ player, size = 28, style, scored = false, winning = false, tone, bg }) {
  const t = useTheme();
  const ink = tone || t.ink;
  const patBg = bg || t.glassFillSolid;
  const id = useMemo(() => ({ halftone: `pm-ht-${++__pmId}`, dotted: `pm-dt-${__pmId}` }), []);
  const glyph = player?.glyph || "circle";
  const mode = player?.fillStyle || "solid";
  const paint =
    mode === "solid"    ? ink :
    mode === "halftone" ? `url(#${id.halftone})` :
    mode === "dotted"   ? `url(#${id.dotted})` :
    "transparent";
  const strokeW = mode === "ring" ? 3.4 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ overflow: "visible", display: "block", ...style }}>
      <defs>
        <pattern id={id.halftone} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <rect width="4" height="4" fill={ink} />
          <rect width="2" height="4" fill={patBg} />
        </pattern>
        <pattern id={id.dotted} patternUnits="userSpaceOnUse" width="5" height="5">
          <rect width="5" height="5" fill={patBg} />
          <circle cx="2.5" cy="2.5" r="1.1" fill={ink} />
        </pattern>
      </defs>
      {scored && <circle cx="20" cy="20" r="18" fill={ink} opacity="0.08" />}
      {glyph === "circle" && (
        <circle cx="20" cy="20" r={mode === "ring" ? 13 : 13.5}
          fill={paint} stroke={ink} strokeWidth={strokeW} />
      )}
      {glyph === "triangle" && (
        <path d="M20 7 L33 31 L7 31 Z"
          fill={paint} stroke={ink} strokeWidth={strokeW || 1} strokeLinejoin="round" />
      )}
      {glyph === "square" && (
        <rect x="8" y="8" width="24" height="24" rx="3.5"
          fill={paint} stroke={ink} strokeWidth={strokeW || 1} strokeLinejoin="round" />
      )}
      {glyph === "diamond" && (
        <path d="M20 6 L34 20 L20 34 L6 20 Z"
          fill={paint} stroke={ink} strokeWidth={strokeW || 1} strokeLinejoin="round" />
      )}
      {glyph === "ring" && (
        <>
          <circle cx="20" cy="20" r="13.5" fill="none" stroke={ink} strokeWidth="3.4" />
          <circle cx="20" cy="20" r="5" fill={ink} />
        </>
      )}
      {winning && (
        <circle cx="20" cy="20" r="18" fill="none" stroke={ink} strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values="14;21;14" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.55;0;0.55" dur="2.2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

export function ReconnectBanner() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ background: "#F59E0B", color: "#fff", padding: "6px 16px", fontSize: 13, fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", animation: "pulse 1s ease-in-out infinite" }} />
      Reconnecting{secs > 2 ? `... (${secs}s)` : "..."}
    </div>
  );
}

export function Confetti({ color }) {
  const pieces = useMemo(() => {
    const colors = [color, "#F2A93B", "#4DAA6D", "#E57AC6", "#4A7BF7"];
    return Array.from({ length: 60 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      dx: (Math.random() - 0.5) * 300,
      dy: 400 + Math.random() * 300,
      rot: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: Math.random() * 0.3,
      duration: 1.4 + Math.random() * 1.2,
      shape: Math.random() > 0.5 ? "50%" : "2px",
    }));
  }, [color]);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60, overflow: "hidden" }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position: "absolute", top: "-20px", left: `${p.left}%`,
          width: p.size, height: p.size, background: p.color, borderRadius: p.shape,
          animation: `confettiFall ${p.duration}s ease-out ${p.delay}s forwards`,
          "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--rot": `${p.rot}deg`,
        }} />
      ))}
    </div>
  );
}

export function RollingNumber({ value, style }) {
  const [display, setDisplay] = useState(value);
  const [prev, setPrev] = useState(value);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (value === display) return;
    setPrev(display);
    setAnimating(true);
    const id = setTimeout(() => { setDisplay(value); setAnimating(false); }, 320);
    return () => clearTimeout(id);
  }, [value, display]);
  const h = "1em";
  return (
    <span style={{ display: "inline-block", position: "relative", height: h, overflow: "hidden", verticalAlign: "bottom", minWidth: "0.6em", ...style }}>
      <span style={{
        display: "block",
        transform: animating ? "translateY(-100%)" : "translateY(0)",
        transition: animating ? "transform 0.32s cubic-bezier(0.34,1.56,0.64,1)" : "none",
      }}>
        <span style={{ display: "block", height: h, lineHeight: h }}>{animating ? prev : display}</span>
        <span style={{ display: "block", height: h, lineHeight: h }}>{value}</span>
      </span>
    </span>
  );
}

export function Collapse({ open, maxH = 400, children }) {
  return (
    <div style={{
      maxHeight: open ? maxH : 0, opacity: open ? 1 : 0,
      overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
      willChange: "max-height, opacity",
    }}>{children}</div>
  );
}
