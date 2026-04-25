import { useState, useCallback, useRef, useEffect, useMemo, createContext, useContext } from "react";
import {
  PLAYERS, POWERS, getWinConditions, makeBoard, cloneBoard,
  revealGhosts, scoreAndMark, applyPendingLineScore, aiPickMove, aiPickMoveHard, aiPickPowerAction, aiPlanPowerAction,
  canPickLineSlot,
  isBoardFull, getScoredCells, generateRoomCode,
  getBlockSize, getPowerCd, isBlocked, pruneBlocks,
} from "../lib/gameLogic.js";
import { createConnection, subscribeToLobby } from "./multiplayer.js";
import { sfx, haptic, soundEnabled, setSoundEnabled, hapticEnabled, setHapticEnabled, reducedMotion, setReducedMotion } from "./sounds.js";
import { getStats, recordGame, clearStats, getTotalGames, getTotalWins, getWinRate } from "./stats.js";

/** Resolve scoring for AI: always uses the first valid segment on overlong lines. */
function flushScorePending(b, playerCount, lineLen, scoresIn, teams) {
  let r = scoreAndMark(b, playerCount, lineLen, scoresIn, teams);
  while (r.pending) {
    r = applyPendingLineScore(b, playerCount, lineLen, r.pending, 0, r.scores, teams);
  }
  return r.scores;
}

// Monochrome glass theme (iOS-26 feel) — warm bone/ink family, frosted surfaces.
// Legacy keys (bg/card/text/btnPrimary/...) stay populated so untouched inline styles
// keep working while we roll out glass primitives everywhere.
const THEMES = {
  light: {
    mode: "light",
    // Glass tokens
    bg1: "#F6F3EE", bg2: "#EAE4DA",
    bgBlob: "#FFFFFF", bgBlob2: "#D9D2C3",
    ink: "#1A1714", inkSoft: "#4A453E", inkMuted: "#7C766C", inkFaint: "#A9A196",
    inkGhost: "rgba(26,23,20,0.14)",
    glassFill: "rgba(255,253,249,0.58)",
    glassFillSolid: "#FBF8F1",
    glassFillStrong: "rgba(255,253,249,0.82)",
    glassBorder: "rgba(255,255,255,0.65)",
    glassBorderInk: "rgba(26,23,20,0.06)",
    glassShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 34px rgba(60,40,20,0.08), 0 2px 6px rgba(60,40,20,0.04)",
    hair: "rgba(26,23,20,0.08)",
    hairStrong: "rgba(26,23,20,0.16)",
    accentInk: "#1A1714", accentOnInk: "#FBF8F1",
    focus: "rgba(26,23,20,0.22)",

    // Legacy compatibility (keep inline styles that read these working)
    bg: "#F6F3EE", card: "rgba(255,253,249,0.78)",
    cardShadow: "0 1px 0 rgba(255,255,255,0.7) inset, 0 12px 34px rgba(60,40,20,0.08), 0 2px 6px rgba(60,40,20,0.04)",
    text: "#1A1714", textMuted: "#7C766C", textFaint: "#A9A196", textLabel: "#7C766C",
    border: "rgba(26,23,20,0.16)", borderLight: "rgba(26,23,20,0.08)",
    surface: "rgba(255,253,249,0.58)", surfaceAlt: "rgba(255,253,249,0.4)",
    cell: "rgba(255,253,249,0.62)", cellWall: "rgba(26,23,20,0.06)", grid: "rgba(26,23,20,0.12)",
    btnPrimary: "#1A1714", btnPrimaryText: "#FBF8F1",
    toast: "rgba(26,23,20,0.92)", toastText: "#FBF8F1",
  },
  dark: {
    mode: "dark",
    bg1: "#1B1915", bg2: "#0F0E0B",
    bgBlob: "#3B332A", bgBlob2: "#0A0908",
    ink: "#F5F0E6", inkSoft: "#C3BCAD", inkMuted: "#8A8275", inkFaint: "#5B5449",
    inkGhost: "rgba(245,240,230,0.14)",
    glassFill: "rgba(60,54,46,0.44)",
    glassFillSolid: "#24211C",
    glassFillStrong: "rgba(60,54,46,0.68)",
    glassBorder: "rgba(255,250,240,0.1)",
    glassBorderInk: "rgba(0,0,0,0.4)",
    glassShadow: "0 1px 0 rgba(255,250,240,0.08) inset, 0 14px 40px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
    hair: "rgba(245,240,230,0.1)",
    hairStrong: "rgba(245,240,230,0.2)",
    accentInk: "#F5F0E6", accentOnInk: "#1B1915",
    focus: "rgba(245,240,230,0.3)",

    bg: "#1B1915", card: "rgba(60,54,46,0.56)",
    cardShadow: "0 1px 0 rgba(255,250,240,0.08) inset, 0 14px 40px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)",
    text: "#F5F0E6", textMuted: "#8A8275", textFaint: "#5B5449", textLabel: "#8A8275",
    border: "rgba(245,240,230,0.2)", borderLight: "rgba(245,240,230,0.1)",
    surface: "rgba(60,54,46,0.44)", surfaceAlt: "rgba(60,54,46,0.3)",
    cell: "rgba(60,54,46,0.5)", cellWall: "rgba(245,240,230,0.08)", grid: "rgba(245,240,230,0.14)",
    btnPrimary: "#F5F0E6", btnPrimaryText: "#1B1915",
    toast: "rgba(245,240,230,0.92)", toastText: "#1B1915",
  },
};

const ThemeCtx = createContext(THEMES.light);
function useTheme() { return useContext(ThemeCtx); }

function themeVars(t) {
  return Object.entries(t).map(([k,v]) => `--${k}: ${v};`).join(" ");
}

// Monochrome player mark — shape + fill-style differentiates, not colour.
// glyph: circle | triangle | square | diamond | ring
// fillStyle: solid | ring | halftone | dotted
let __pmId = 0;
function PlayerMark({ player, size = 28, style, scored = false, winning = false, tone, bg }) {
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

const css = `
  @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-8px); } }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(26,23,20,0.22); } 50% { box-shadow: 0 0 0 6px rgba(26,23,20,0); } }
  @keyframes glassFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes glassPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  .g-pop { animation: glassPop 420ms cubic-bezier(0.34,1.56,0.64,1); }
  .g-float { animation: glassFloat 4.6s ease-in-out infinite; }
  .glass-bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%); }
  .glass-bg::before, .glass-bg::after { content: ''; position: absolute; border-radius: 50%;
    filter: blur(40px); pointer-events: none; }
  .glass-bg::before { top: -8%; right: -18%; width: 70%; height: 60%;
    background: radial-gradient(closest-side, var(--bgBlob) 0%, transparent 70%); opacity: 0.8; }
  .glass-bg::after { bottom: -12%; left: -20%; width: 80%; height: 55%;
    background: radial-gradient(closest-side, var(--bgBlob2) 0%, transparent 72%); opacity: 0.66; }
  .glass-card { background: var(--glassFill); backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%); border: 0.5px solid var(--glassBorder);
    box-shadow: var(--glassShadow); border-radius: 18px; }
  @keyframes scoreGlow { 0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; } 40% { box-shadow: 0 0 8px 4px currentColor; opacity: 0.8; } 100% { box-shadow: none; opacity: 0.35; } }
  @keyframes wallDrop { 0% { transform: scale(0) rotate(-45deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 0.35; } }
  @keyframes ghostFade { 0% { opacity: 0; transform: scale(1.3); } 100% { opacity: 0.5; transform: scale(1); } }
  @keyframes stealFlash { 0% { background: rgba(242,92,84,0.3); } 100% { background: transparent; } }
  @keyframes revealPop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes winPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
  @keyframes timerShrink { from { width: 100%; } to { width: 0%; } }
  @keyframes timerShake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scoreBump { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
  @keyframes slotPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 0.95; } }
  @keyframes slotFillIn { 0% { opacity: 0; transform: scale(0.92); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes boardIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes bannerIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes miniIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
  * { box-sizing: border-box; margin: 0; touch-action: manipulation; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; overscroll-behavior: none; background: var(--bg); color: var(--text); transition: background 0.3s, color 0.3s; }
  input[type=range] { accent-color: #1A1714; }
  .zoom-slider { -webkit-appearance: none; appearance: none; background: transparent; width: 100%; height: 28px;
    cursor: pointer; touch-action: pan-y pinch-zoom; }
  .zoom-slider:focus { outline: none; }
  .zoom-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px;
    background: var(--zoomTrack, rgba(26,23,20,0.12)); }
  .zoom-slider::-moz-range-track { height: 4px; border-radius: 2px;
    background: var(--zoomTrack, rgba(26,23,20,0.12)); }
  .zoom-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
    width: 22px; height: 22px; border-radius: 50%; margin-top: -9px;
    background: var(--zoomThumb, #1A1714); border: 2px solid var(--zoomThumbRing, #FBF8F1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.1);
    cursor: grab; transition: transform 0.12s ease-out; }
  .zoom-slider::-webkit-slider-thumb:active { transform: scale(1.18); cursor: grabbing; }
  .zoom-slider::-moz-range-thumb {
    width: 22px; height: 22px; border-radius: 50%;
    background: var(--zoomThumb, #1A1714); border: 2px solid var(--zoomThumbRing, #FBF8F1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.18); cursor: grab; transition: transform 0.12s ease-out; }
  .zoom-slider::-moz-range-thumb:active { transform: scale(1.18); cursor: grabbing; }
  .zoom-step { display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 10px; font-size: 14px; cursor: pointer;
    color: var(--zoomStep, rgba(26,23,20,0.55)); background: transparent; border: none;
    flex-shrink: 0; user-select: none; -webkit-tap-highlight-color: transparent;
    transition: background 0.15s, color 0.15s; }
  .zoom-step:hover { background: rgba(26,23,20,0.06); color: var(--zoomStepActive, #1A1714); }
  .zoom-step:active { transform: scale(0.9); }
  .zoom-step:disabled { opacity: 0.3; cursor: default; }
  .cell:hover .cell-hover { background: rgba(26,23,20,0.05); }
  .cell:hover .hover-dot { opacity: 0.26; transform: scale(1); }
  .btn-hover { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.12s, opacity 0.12s; }
  .btn-hover:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .btn-hover:active { transform: translateY(0) scale(0.93); box-shadow: none; transition: transform 0.08s ease-out, box-shadow 0.08s; }
  @keyframes confettiFall { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
  @keyframes bannerSlide { 0% { opacity: 0; transform: translateY(-18px) scale(0.95); } 60% { transform: translateY(2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes modalCardIn { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes bannerShine { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
  @keyframes skeletonShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes turnPulse { 0% { opacity: 0.75; } 100% { opacity: 1; } }
  @keyframes turnGlow { 0% { opacity: 0; } 35% { opacity: 0.55; } 100% { opacity: 0; } }
  select { color-scheme: light dark; }
`;

function ReconnectBanner() {
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

function Confetti({ color }) {
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

function RollingNumber({ value, style }) {
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

function Collapse({ open, maxH = 400, children }) {
  return (
    <div style={{
      maxHeight: open ? maxH : 0, opacity: open ? 1 : 0,
      overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
      willChange: "max-height, opacity",
    }}>{children}</div>
  );
}

function StatsScreen({ onBack, dark, setDark }) {
  const t = useTheme();
  const [stats, setStats] = useState(getStats);
  const total = getTotalGames(stats);
  const wins = getTotalWins(stats);
  const rate = getWinRate(stats);

  const modes = [
    { key: "local", label: "Local", icon: "👥" },
    { key: "ai", label: "vs AI", icon: "🤖" },
    { key: "online", label: "Online", icon: "🌐" },
  ];

  const resultTone = { win: t.ink, loss: t.inkMuted, draw: t.inkFaint };
  const resultLabels = { win: "Won", loss: "Lost", draw: "Draw" };

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none" }}>
        <div style={{
          background: t.glassFill, backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: `0.5px solid ${t.glassBorder}`, boxShadow: t.glassShadow,
          borderRadius: 22, padding: "32px 28px", width: "100%", maxWidth: 420,
          animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-hover" onClick={onBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.ink, flex: 1 }}>Stats</h1>
            <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, color: t.inkMuted }}>{dark ? "☀" : "☾"}</button>
          </div>

          {/* Summary */}
          <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
            {[
              { label: "Games", value: total },
              { label: "Wins", value: wins },
              { label: "Win Rate", value: `${rate}%` },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "14px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: t.inkMuted, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Per-mode breakdown */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>By Mode</div>
            {modes.map(m => {
              const s = stats[m.key] || { wins: 0, losses: 0, draws: 0, games: 0 };
              return (
                <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, marginBottom: 4 }}>
                  <span style={{ fontSize: 16 }}>{m.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: t.ink }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: t.ink, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.wins}<span style={{ color: t.inkFaint, fontWeight: 500 }}>W</span></span>
                  <span style={{ fontSize: 12, color: t.inkMuted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.losses}<span style={{ color: t.inkFaint, fontWeight: 500 }}>L</span></span>
                  <span style={{ fontSize: 12, color: t.inkMuted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.draws}<span style={{ color: t.inkFaint, fontWeight: 500 }}>D</span></span>
                </div>
              );
            })}
          </div>

          {/* Recent games */}
          {stats.history?.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Recent Games</div>
              <div style={{ maxHeight: 200, overflow: "auto", borderRadius: 12, border: `0.5px solid ${t.hair}`, background: t.glassFillSolid }}>
                {stats.history.map((g, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: 13, borderTop: i === 0 ? "none" : `0.5px solid ${t.hair}` }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: resultTone[g.result], flexShrink: 0 }} />
                    <span style={{ color: resultTone[g.result], fontWeight: 600, width: 36 }}>{resultLabels[g.result]}</span>
                    <span style={{ color: t.inkMuted, flex: 1 }}>{g.mode === "ai" ? "vs AI" : g.mode} · {g.gridSize}x{g.gridSize}</span>
                    <span style={{ color: t.inkFaint, fontSize: 11 }}>{new Date(g.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {total > 0 && (
            <button className="btn-hover" onClick={() => { if (confirm("Clear all stats?")) setStats(clearStats()); }} style={{
              width: "100%", padding: 10, borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
              background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
              fontSize: 13, color: t.inkMuted, cursor: "pointer",
              fontFamily: "inherit", marginTop: 20,
            }}>Clear Stats</button>
          )}
        </div>
      </div>
    </>
  );
}

function SettingsScreen({ onBack, onReplayTutorial, dark, setDark }) {
  const t = useTheme();
  const [sound, setSound] = useState(soundEnabled());
  const [haptics, setHaptics] = useState(hapticEnabled());
  const [motion, setMotion] = useState(reducedMotion());
  const [name, setName] = useState(() => { try { return localStorage.getItem("mtt-player-name") || ""; } catch { return ""; } });
  const [cleared, setCleared] = useState(false);

  const saveName = (v) => {
    setName(v);
    try { localStorage.setItem("mtt-player-name", v); } catch {}
  };

  const clearAll = () => {
    if (!confirm("Clear all saved data? This will reset stats, settings, and any saved game.")) return;
    try {
      const keys = ["mtt-stats", "mtt-saved-game", "mtt-setup-config", "mtt-tutorial-seen", "mtt-last-room", "mtt-player-name", "mtt-sound-enabled", "mtt-haptic-enabled", "mtt-reduced-motion", "mtt-lobby-debug"];
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
    setCleared(true);
    setTimeout(() => setCleared(false), 1800);
  };

  const Section = ({ title, children }) => (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );

  const Row = ({ label, hint, control }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, marginBottom: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: t.ink }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: t.inkMuted, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );

  const Toggle = ({ on, onChange }) => (
    <button onClick={onChange} aria-pressed={on} style={{
      width: 44, height: 24, borderRadius: 14, border: "none", padding: 0, cursor: "pointer",
      background: on ? t.ink : t.glassFillSolid,
      boxShadow: on ? "none" : `inset 0 0 0 0.5px ${t.hairStrong}`,
      position: "relative", transition: "background 0.2s",
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 22 : 2,
        width: 20, height: 20, borderRadius: "50%",
        background: on ? (t.mode === "dark" ? t.bg1 : "#FAF7F0") : t.ink,
        transition: "left 0.2s cubic-bezier(0.34,1.56,0.64,1)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
      }} />
    </button>
  );

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none" }}>
        <div style={{
          background: t.glassFill, backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: `0.5px solid ${t.glassBorder}`, boxShadow: t.glassShadow,
          borderRadius: 22, padding: "28px 24px", width: "100%", maxWidth: 460,
          animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-hover" onClick={onBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.ink, flex: 1 }}>Settings</h1>
            <span style={{ width: 28 }} />
          </div>

          <Section title="Appearance">
            <div style={{ display: "flex", background: t.inkGhost, borderRadius: 12, padding: 3, gap: 2, border: `0.5px solid ${t.hair}` }}>
              {[{ k: false, label: "Light", icon: "☀" }, { k: true, label: "Dark", icon: "☾" }].map(opt => (
                <button key={opt.label} onClick={() => setDark(opt.k)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 500,
                  cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                  background: dark === opt.k ? t.glassFillSolid : "transparent",
                  color: dark === opt.k ? t.ink : t.inkMuted,
                  boxShadow: dark === opt.k ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>{opt.icon}</span>{opt.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Sound & Feedback">
            <Row
              label="Sound effects"
              hint="Plays subtle tones for moves, scores, and wins."
              control={<Toggle on={sound} onChange={() => { const v = !sound; setSound(v); setSoundEnabled(v); if (v) sfx.click(); }} />}
            />
            <Row
              label="Haptics"
              hint="Vibration cues on supported mobile devices."
              control={<Toggle on={haptics} onChange={() => { const v = !haptics; setHaptics(v); setHapticEnabled(v); if (v) haptic.tap(); }} />}
            />
          </Section>

          <Section title="Motion">
            <Row
              label="Reduce ambient motion"
              hint="Hides the home-screen flourish animation."
              control={<Toggle on={motion} onChange={() => { const v = !motion; setMotion(v); setReducedMotion(v); }} />}
            />
          </Section>

          <Section title="Online">
            <div style={{ background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Player name</div>
              <input value={name} onChange={e => saveName(e.target.value.slice(0, 16))} placeholder="Your display name"
                style={{
                  width: "100%", marginTop: 6, padding: "6px 0", borderRadius: 0, border: "none",
                  borderBottom: `0.5px solid ${t.hair}`,
                  background: "transparent", fontSize: 15, fontWeight: 500, color: t.ink,
                  fontFamily: "inherit", outline: "none",
                }} />
            </div>
          </Section>

          <Section title="Help">
            <button className="btn-hover" onClick={onReplayTutorial} style={{
              width: "100%", padding: 12, borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
              background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
              fontSize: 14, fontWeight: 500, color: t.ink, cursor: "pointer", fontFamily: "inherit",
            }}>Replay tutorial</button>
          </Section>

          <Section title="Data">
            <button className="btn-hover" onClick={clearAll} style={{
              width: "100%", padding: 12, borderRadius: 12,
              border: `0.5px solid rgba(200,84,74,${cleared ? 0.45 : 0.3})`,
              background: cleared ? "rgba(200,84,74,0.16)" : "rgba(200,84,74,0.08)",
              fontSize: 13, fontWeight: 500, color: "#C8544A", cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.2s",
            }}>{cleared ? "Cleared — reload to apply" : "Clear all saved data"}</button>
          </Section>

          <p style={{ marginTop: 22, fontSize: 11, color: t.inkFaint, textAlign: "center", letterSpacing: "0.4px" }}>
            Mega Tic Tac Toe
          </p>
        </div>
      </div>
    </>
  );
}

function LobbyPresence({ roomCode, players, you, playerCount, gridSize, mode }) {
  const t = useTheme();
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Faint shape grid backdrop for visual continuity — static, no flourish */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.22, pointerEvents: "none" }}>
        <HeroShapeGrid gridSize={gridSize} playerCount={playerCount} mode={mode} staticBackdrop />
      </div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 28, padding: "4px 4px" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.6px", textTransform: "uppercase" }}>Room code</div>
          <div style={{
            fontSize: "clamp(56px, 8.4vw, 92px)", fontWeight: 800, letterSpacing: "0.14em",
            lineHeight: 1, color: t.ink, marginTop: 8, fontVariantNumeric: "tabular-nums",
            textShadow: `0 1px 0 ${t.glassBorder}`,
          }}>{roomCode || "----"}</div>
          <div style={{ fontSize: 12, color: t.inkMuted, marginTop: 10, letterSpacing: "0.3px" }}>
            Share this code with up to {playerCount - 1} {playerCount === 2 ? "friend" : "friends"} to start playing.
          </div>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: playerCount > 2 ? "1fr 1fr" : "1fr",
          gap: 10,
        }}>
          {Array.from({ length: playerCount }).map((_, slot) => {
            const p = players.find(pl => pl.slot === slot);
            const filled = !!p;
            const isYou = you === slot;
            return (
              <div key={slot} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14,
                background: filled ? t.glassFillSolid : "transparent",
                border: filled ? `0.5px solid ${t.hair}` : `1.5px dashed ${t.hairStrong}`,
                animation: filled ? "slotFillIn 0.45s cubic-bezier(0.34,1.56,0.64,1)" : "slotPulse 2.4s ease-in-out infinite",
                transition: "background 0.25s, border-color 0.25s",
                minHeight: 60,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: filled ? t.ink : "transparent",
                  border: filled ? "none" : `1px dashed ${t.hairStrong}`,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  transition: "background 0.25s, border-color 0.25s",
                }}>
                  <PlayerMark
                    player={PLAYERS[slot]}
                    size={22}
                    tone={filled ? (t.mode === "dark" ? t.bg1 : "#FAF7F0") : t.inkFaint}
                    bg={filled ? t.ink : t.bg1}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: filled ? t.ink : t.inkFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {filled ? p.name : "Waiting…"}
                  </div>
                  <div style={{ fontSize: 11, color: t.inkMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{PLAYERS[slot].name}</span>
                    {filled && slot === 0 && <span style={{ padding: "1px 6px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontSize: 10, fontWeight: 600, letterSpacing: "0.4px" }}>HOST</span>}
                    {filled && isYou && <span style={{ padding: "1px 6px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontSize: 10, fontWeight: 600, letterSpacing: "0.4px" }}>YOU</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OnlineLobby({ onBack, onGameStart, dark, setDark }) {
  const t = useTheme();
  const lobbyDebugEnabled = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("lobbyDebug") === "1") return true;
      return localStorage.getItem("mtt-lobby-debug") === "1";
    } catch {
      return false;
    }
  }, []);
  const [tab, setTab] = useState("menu"); // menu | create | join
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [conn, setConn] = useState(null);
  const [players, setPlayers] = useState([]);
  const [you, setYou] = useState(-1);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [copied, setCopied] = useState(false);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("mtt-player-name") || "");
  const [lastRoom, setLastRoom] = useState(() => { try { return localStorage.getItem("mtt-last-room") || ""; } catch { return ""; } });
  const [awaitingStartAck, setAwaitingStartAck] = useState(false);
  const awaitingStartAckRef = useRef(false);
  const youRef = useRef(you);

  useEffect(() => { awaitingStartAckRef.current = awaitingStartAck; }, [awaitingStartAck]);
  useEffect(() => { youRef.current = you; }, [you]);

  // Config state (host only)
  const [mode, setMode] = useState("normal");
  const [gridSize, setGridSize] = useState(12);
  const [powers, setPowers] = useState([0, 1, 2, 3]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLineLen, setCustomLineLen] = useState(null);
  const [customLinesNeeded, setCustomLinesNeeded] = useState(null);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(15);
  const [playerCount, setPlayerCount] = useState(2);
  const [isPublic, setIsPublic] = useState(false);
  const [publicRooms, setPublicRooms] = useState([]);
  const [lobbyDebugEvents, setLobbyDebugEvents] = useState([]);
  const autoWc = getWinConditions(gridSize, playerCount);
  const wc = {
    lineLen: customLineLen ?? autoWc.lineLen,
    linesNeeded: customLinesNeeded ?? autoWc.linesNeeded,
  };
  const usedPowers = powers.slice(0, playerCount);
  const hasDupes = mode === "powers" && new Set(usedPowers).size < usedPowers.length;

  const connectToRoom = useCallback((code, isHost) => {
    setRoomCode(code);
    setStatus("connecting");
    setError(null);

    const connection = createConnection(code, (msg) => {
      switch (msg.type) {
        case "room-state":
          setYou(msg.you);
          setPlayers(msg.players || []);
          setStatus("connected");
          if (msg.phase === "playing" || msg.phase === "review") {
            onGameStart(connection, msg);
          }
          break;
        case "player-joined":
          setPlayers(prev => {
            const idx = prev.findIndex(p => p.slot === msg.slot);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], name: msg.name };
              return next;
            }
            return [...prev, { slot: msg.slot, name: msg.name }];
          });
          break;
        case "player-left":
          setPlayers(prev => prev.filter(p => p.slot !== msg.slot));
          break;
        case "spectator-joined":
        case "spectator-renamed":
          break;
        case "config-updated":
          if (awaitingStartAckRef.current && youRef.current === 0) {
            awaitingStartAckRef.current = false;
            setAwaitingStartAck(false);
            connection.start();
          }
          break;
        case "game-started":
        case "move-applied":
        case "game-over":
          awaitingStartAckRef.current = false;
          setAwaitingStartAck(false);
          onGameStart(connection, msg);
          break;
        case "error":
          awaitingStartAckRef.current = false;
          setAwaitingStartAck(false);
          setError(msg.message);
          connection.close();
          setTimeout(() => setError(null), 3000);
          break;
        default: break;
      }
    });

    // Join once immediately; PartySocket queues this until the socket opens.
    const name = (playerName || "").trim() || (isHost ? "Host" : "Guest");
    connection.join(name);

    connection.ws.addEventListener("open", () => {
      setStatus("connected");
    });
    connection.ws.addEventListener("error", () => {
      setError("Connection failed");
      setStatus("error");
    });
    connection.ws.addEventListener("close", () => {
      setStatus("disconnected");
    });

    setConn(connection);
    return connection;
  }, [onGameStart, playerName]);

  const createRoom = useCallback(() => {
    const code = generateRoomCode();
    setTab("create");
    connectToRoom(code, true);
  }, [connectToRoom]);

  const joinRoom = useCallback(() => {
    if (joinCode.length !== 4) { setError("Enter a 4-character code"); return; }
    setTab("join");
    connectToRoom(joinCode.toUpperCase(), false);
  }, [joinCode, connectToRoom]);

  const startGame = useCallback(() => {
    if (!conn) return;
    if (hasDupes) return;
    const config = {
      mode, gridSize, playerCount,
      powers: powers.slice(0, playerCount),
      ...wc,
      timer: timerEnabled ? timerSeconds : 0,
      ai: false,
      public: isPublic,
    };
    awaitingStartAckRef.current = true;
    setAwaitingStartAck(true);
    conn.setConfig(config);
  }, [conn, mode, gridSize, powers, wc, timerEnabled, timerSeconds, hasDupes, isPublic]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomCode]);

  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [roomCode]);

  // When a room is created/joined, reflect the code in the URL so the host's
  // browser URL is directly shareable and refresh-safe.
  useEffect(() => {
    if (!roomCode) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") !== roomCode) {
      url.searchParams.set("room", roomCode);
      window.history.replaceState({}, "", url.toString());
    }
  }, [roomCode]);

  // Auto-join from ?room=CODE on first mount
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("room");
    if (code && /^[A-Z0-9]{4}$/i.test(code)) {
      autoJoinedRef.current = true;
      setTab("join");
      setJoinCode(code.toUpperCase());
      connectToRoom(code.toUpperCase(), false);
    }
  }, [connectToRoom]);

  // Note: no cleanup-on-unmount here — when the game starts, the lobby
  // unmounts but the parent takes ownership of the connection via onGameStart.
  // Explicit "Back" button handles closing.

  const isHost = you === 0;
  const seatedPlayers = players.filter(p => p.slot >= 0);
  const opponentJoined = seatedPlayers.length >= playerCount;

  // Push config to server when host changes settings (so the join cap matches)
  useEffect(() => {
    if (!conn || !isHost) return;
    const config = {
      mode, gridSize, playerCount,
      powers: powers.slice(0, playerCount),
      ...wc,
      timer: timerEnabled ? timerSeconds : 0,
      ai: false,
      public: isPublic,
    };
    conn.setConfig(config);
  }, [conn, isHost, mode, gridSize, playerCount, powers, wc.lineLen, wc.linesNeeded, timerEnabled, timerSeconds, isPublic]);

  // Subscribe to public room list while on the browse tab
  useEffect(() => {
    if (tab !== "browse") return;
    setLobbyDebugEvents([]);
    const sub = subscribeToLobby({
      onRooms: setPublicRooms,
      onDebug: lobbyDebugEnabled
        ? (evt) => {
            setLobbyDebugEvents((prev) => {
              const next = [...prev, evt];
              return next.slice(-40);
            });
          }
        : null,
    });
    return () => sub.close();
  }, [tab, lobbyDebugEnabled]);

  const leaveLobby = useCallback(() => {
    if (conn) {
      conn.close();
      setConn(null);
    }
    onBack();
  }, [conn, onBack]);

  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 960);
  useEffect(() => {
    const on = () => setIsWide(window.innerWidth >= 960);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const inRoom = tab === "create" || tab === "join";

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: isWide ? "40px 56px" : 20, userSelect: "none" }}>
      <div style={{
        width: "100%", maxWidth: isWide ? 1200 : 440,
        display: "grid", gridTemplateColumns: isWide ? "1.1fr 1fr" : "1fr",
        gap: isWide ? 64 : 0, alignItems: "stretch",
        animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {isWide && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28, minHeight: 620 }}>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <button className="btn-hover" onClick={leaveLobby} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            </div>
            {!inRoom && (
              <div>
                <h1 style={{ fontSize: "clamp(48px, 5.4vw, 72px)", fontWeight: 800, letterSpacing: "-0.045em", color: t.ink, lineHeight: 0.92 }}>Play<br />Online</h1>
                <p style={{ fontSize: 16, color: t.inkMuted, marginTop: 18, maxWidth: 420, lineHeight: 1.5 }}>
                  Match up with friends or jump into a public room. Rooms hold up to four players, each with their own shape signature.
                </p>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 280, position: "relative" }}>
              {inRoom
                ? <LobbyPresence roomCode={roomCode} players={players} you={you} playerCount={playerCount} gridSize={gridSize} mode={mode} />
                : <HeroShapeGrid gridSize={gridSize} playerCount={playerCount} mode={mode} />}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", maxWidth: isWide ? 460 : "none", marginLeft: isWide ? 0 : "auto", marginRight: isWide ? 0 : "auto" }}>
        {!isWide && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-hover" onClick={leaveLobby} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", textAlign: "center", color: t.ink, flex: 1 }}>Play Online</h1>
            <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7 }}>{dark ? "☀" : "☾"}</button>
          </div>
        )}
        {isWide && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7 }}>{dark ? "☀" : "☾"}</button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 16, padding: "8px 14px", borderRadius: 10, background: "rgba(200,84,74,0.12)", border: "0.5px solid rgba(200,84,74,0.3)", color: "#C8544A", fontSize: 13, fontWeight: 500, textAlign: "center", animation: "slideUp 0.2s ease-out" }}>
            {error}
          </div>
        )}

        {tab === "menu" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Your Name</div>
            <input
              type="text"
              placeholder="Enter your name"
              maxLength={20}
              value={playerName}
              onChange={e => { const v = e.target.value; setPlayerName(v); localStorage.setItem("mtt-player-name", v); }}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 12, border: `0.5px solid ${t.hair}`,
                fontSize: 15, fontWeight: 500, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink,
                outline: "none", marginBottom: 20, boxSizing: "border-box",
              }}
            />
            {lastRoom && (
              <button className="btn-hover" onClick={() => { setJoinCode(lastRoom); setTab("join"); connectToRoom(lastRoom, false); }} style={{
                width: "100%", padding: 12, borderRadius: 14, border: "0.5px solid rgba(200,84,74,0.4)", fontSize: 14, fontWeight: 600,
                cursor: "pointer", background: "rgba(200,84,74,0.12)", color: "#C8544A",
                fontFamily: "inherit", marginBottom: 12,
              }}>Resume game {lastRoom}</button>
            )}
            <button className="btn-hover" onClick={createRoom} style={{
              width: "100%", padding: 16, borderRadius: 14, border: `0.5px solid ${t.ink}`, fontSize: 15, fontWeight: 600,
              cursor: "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0",
              fontFamily: "inherit", marginBottom: 12,
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            }}>Create Room</button>
            <div style={{ fontSize: 12, color: t.inkMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.5px", margin: "16px 0" }}>or join a friend</div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <input
                type="text"
                placeholder="ABCD"
                maxLength={4}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                style={{
                  flex: 1, minWidth: 0, padding: "12px 16px", borderRadius: 12, border: `0.5px solid ${t.hair}`,
                  fontSize: 18, fontWeight: 700, textAlign: "center", letterSpacing: 6,
                  fontFamily: "inherit", background: t.glassFillSolid, color: t.ink, outline: "none",
                }}
              />
              <button className="btn-hover" onClick={joinRoom} style={{
                flexShrink: 0, padding: "12px 20px", borderRadius: 12, border: "none", fontSize: 14, fontWeight: 600,
                cursor: "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0", fontFamily: "inherit",
              }}>Join</button>
            </div>
            <button className="btn-hover" onClick={() => setTab("browse")} style={{
              width: "100%", padding: 12, borderRadius: 12, border: `0.5px solid ${t.hair}`, fontSize: 13, fontWeight: 500,
              cursor: "pointer", background: t.glassFillSolid, color: t.inkMuted, fontFamily: "inherit", marginTop: 16,
            }}>Browse public rooms</button>
          </div>
        )}

        {tab === "browse" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
              Public rooms ({publicRooms.length})
            </div>
            {publicRooms.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", color: t.inkMuted, fontSize: 13, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12 }}>
                No public rooms right now.<br />
                <span style={{ fontSize: 11 }}>Create one and mark it public to share.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {publicRooms.map(r => (
                  <div key={r.code} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.ink, letterSpacing: 2 }}>{r.code}</div>
                      <div style={{ fontSize: 11, color: t.inkMuted, marginTop: 2 }}>
                        {r.hostName} · {r.players}/{r.playerCount} · {r.gridSize}×{r.gridSize}
                        {r.mode === "powers" && " · powers"}
                        {r.teams && " · teams"}
                        {r.phase !== "lobby" && ` · ${r.phase}`}
                        {r.spectators > 0 && ` · ${r.spectators} watching`}
                      </div>
                    </div>
                    <button className="btn-hover" disabled={r.phase === "lobby" && r.players >= r.playerCount} onClick={() => { setJoinCode(r.code); setTab("join"); connectToRoom(r.code, false); }} style={{
                      padding: "6px 14px", borderRadius: 10, border: `0.5px solid ${t.hairStrong}`, fontSize: 13, fontWeight: 600,
                      cursor: r.phase === "lobby" && r.players >= r.playerCount ? "not-allowed" : "pointer",
                      background: r.phase !== "lobby" || r.players >= r.playerCount ? t.glassFill : t.ink,
                      color: r.phase !== "lobby" || r.players >= r.playerCount ? t.ink : (t.mode === "dark" ? t.bg1 : "#FAF7F0"),
                      fontFamily: "inherit",
                      backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                      opacity: r.phase === "lobby" && r.players >= r.playerCount ? 0.5 : 1,
                    }}>{r.phase !== "lobby" ? "Spectate" : (r.players >= r.playerCount ? "Full" : "Join")}</button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-hover" onClick={() => setTab("menu")} style={{
              width: "100%", padding: 10, borderRadius: 12, border: `0.5px solid ${t.hair}`, fontSize: 13,
              cursor: "pointer", background: t.glassFillSolid, color: t.inkMuted, fontFamily: "inherit", marginTop: 14,
            }}>Back</button>
            {lobbyDebugEnabled && (
              <div style={{
                marginTop: 12,
                borderRadius: 10,
                border: `1px solid ${t.border}`,
                background: t.surface,
                padding: 10,
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Lobby debug
                  </div>
                  <button className="btn-hover" onClick={() => setLobbyDebugEvents([])} style={{
                    border: "none",
                    background: "transparent",
                    color: t.textMuted,
                    cursor: "pointer",
                    fontSize: 11,
                    padding: 0,
                    fontFamily: "inherit",
                  }}>clear</button>
                </div>
                <div style={{ maxHeight: 130, overflowY: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.35, color: t.textMuted }}>
                  {lobbyDebugEvents.length === 0 ? (
                    <div>No events yet</div>
                  ) : lobbyDebugEvents.map((e, i) => {
                    const tm = new Date(e.at || Date.now()).toLocaleTimeString();
                    const details = [
                      e.event,
                      e.source ? `src=${e.source}` : "",
                      e.code ? `code=${e.code}` : "",
                      typeof e.afterCount === "number" ? `rooms=${e.afterCount}` : (typeof e.roomCount === "number" ? `rooms=${e.roomCount}` : ""),
                      typeof e.players === "number" ? `players=${e.players}` : "",
                      Array.isArray(e.pruned) && e.pruned.length ? `pruned=${e.pruned.length}` : "",
                    ].filter(Boolean).join(" ");
                    return <div key={`${e.at || 0}-${i}`}>[{tm}] {details}</div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {(tab === "create" || tab === "join") && (
          <div style={{ marginTop: 24 }}>
            {status === "connecting" && (
              <div style={{
                padding: "8px 14px", borderRadius: 12, marginBottom: 16,
                display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: t.inkMuted,
                background: t.glassFillSolid, border: `0.5px solid ${t.hair}`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.ink, animation: "pulse 1.5s infinite" }} />
                Connecting to room...
              </div>
            )}
            {/* Room code display — full block on narrow, compact share row on wide */}
            {!isWide ? (
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Room Code</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{roomCode}</span>
                  <button className="btn-hover" onClick={copyCode} style={{
                    background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 10,
                    padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.inkMuted, fontFamily: "inherit",
                  }}>{copied ? "Copied!" : "Copy"}</button>
                  <button className="btn-hover" onClick={copyLink} style={{
                    background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 10,
                    padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.inkMuted, fontFamily: "inherit",
                  }}>{linkCopied ? "Link copied!" : "Share link"}</button>
                </div>
                {isHost && (
                  <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: t.inkMuted }}>List publicly</span>
                    <button onClick={() => setIsPublic(v => !v)} style={{
                      width: 36, height: 20, borderRadius: 10, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                      background: isPublic ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", background: isPublic ? t.bg1 : t.ink, position: "absolute", top: 1,
                        left: isPublic ? 17 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                      }} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-hover" onClick={copyCode} style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
                    background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                    fontSize: 13, fontWeight: 500, color: t.ink, cursor: "pointer", fontFamily: "inherit",
                  }}>{copied ? "Code copied" : "Copy code"}</button>
                  <button className="btn-hover" onClick={copyLink} style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
                    background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                    fontSize: 13, fontWeight: 500, color: t.ink, cursor: "pointer", fontFamily: "inherit",
                  }}>{linkCopied ? "Link copied" : "Share link"}</button>
                </div>
                {isHost && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}` }}>
                    <span style={{ fontSize: 13, color: t.ink }}>List publicly</span>
                    <button onClick={() => setIsPublic(v => !v)} style={{
                      width: 36, height: 20, borderRadius: 10, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                      background: isPublic ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", background: isPublic ? t.bg1 : t.ink, position: "absolute", top: 1,
                        left: isPublic ? 17 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                      }} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Your name (editable in-lobby) */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Your Name</div>
              <input
                type="text"
                placeholder="Enter your name"
                maxLength={20}
                value={playerName}
                onChange={e => {
                  const v = e.target.value;
                  setPlayerName(v);
                  localStorage.setItem("mtt-player-name", v);
                  const trimmed = v.trim();
                  if (conn && trimmed) conn.rename(trimmed);
                }}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 12, border: `0.5px solid ${t.hair}`,
                  fontSize: 14, fontWeight: 500, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink,
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Players — hidden on wide (already in hero presence) */}
            {!isWide && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Players</div>
                {Array.from({ length: playerCount }, (_, slot) => slot).map(slot => {
                  const p = players.find(p => p.slot === slot);
                  return (
                    <div key={slot} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, marginBottom: 4,
                      transition: "background 0.2s",
                    }}>
                      {p ? <PlayerMark player={PLAYERS[slot]} size={16} /> : (
                        <div style={{ width: 14, height: 14, borderRadius: "50%", border: `1px dashed ${t.hair}` }} />
                      )}
                      <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: p ? t.ink : t.inkFaint }}>
                        {p ? `${p.name}${slot === you ? " (you)" : ""}` : "Waiting..."}
                      </span>
                      {p && slot === 0 && <span style={{ fontSize: 11, color: t.ink, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: t.inkGhost, border: `0.5px solid ${t.hair}`, letterSpacing: "0.5px" }}>HOST</span>}
                      {!p && (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.inkFaint, animation: "pulse 1.5s infinite" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Host: game config + start button */}
            {isHost && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
                  <div style={{ display: "flex", background: t.inkGhost, borderRadius: 12, padding: 3, gap: 2, border: `0.5px solid ${t.hair}` }}>
                    {["normal", "powers"].map(m => (
                      <button key={m} onClick={() => setMode(m)} style={{
                        flex: 1, padding: "8px 0", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 500,
                        cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                        background: mode === m ? t.glassFillSolid : "transparent",
                        color: mode === m ? t.ink : t.inkMuted,
                        boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                      }}>{m === "normal" ? "Normal" : "Powers"}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{gridSize}×{gridSize}</span>
                  </div>
                  <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {[2, 3, 4].map(n => {
                      // Can't shrink below currently-joined count
                      const disabled = n < seatedPlayers.length;
                      return (
                        <button key={n} disabled={disabled} onClick={() => setPlayerCount(n)} style={{
                          width: 44, height: 44, borderRadius: 12, fontSize: 16, fontWeight: 600,
                          cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.15s", opacity: disabled ? 0.35 : 1,
                          border: playerCount === n ? `0.5px solid ${t.hairStrong}` : `0.5px solid ${t.hair}`,
                          background: playerCount === n ? t.inkGhost : t.glassFillSolid,
                          color: playerCount === n ? t.ink : t.inkMuted,
                        }}>{n}</button>
                      );
                    })}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{
                          display: "flex",
                          transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s",
                          transform: i < playerCount ? "scale(1)" : "scale(0)",
                          opacity: i < playerCount ? 1 : 0,
                        }}>
                          <PlayerMark player={PLAYERS[i]} size={16} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <Collapse open={mode === "powers"} maxH={260}>
                  <div style={{ marginBottom: 16, paddingBottom: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Assign powers</div>
                    {Array.from({ length: playerCount }).map((_, pi) => (
                      <div key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: t.glassFillSolid, borderRadius: 12, padding: "8px 12px", marginBottom: 6, border: `0.5px solid ${t.hair}` }}>
                        <PlayerMark player={PLAYERS[pi]} size={16} />
                        <span style={{ fontSize: 13, fontWeight: 500, width: 60, flexShrink: 0, color: t.ink }}>{PLAYERS[pi].name}</span>
                        <select value={powers[pi]} onChange={e => { const p = [...powers]; p[pi] = +e.target.value; setPowers(p); }}
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 10, border: `0.5px solid ${t.hair}`, fontSize: 13, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink }}>
                          {POWERS.map((pw, wi) => <option key={wi} value={wi}>{pw.icon} {pw.name}</option>)}
                        </select>
                      </div>
                    ))}
                    {hasDupes && <p style={{ fontSize: 12, color: "#C8544A", marginTop: 4 }}>Each player should have a unique power</p>}
                  </div>
                </Collapse>

                <div style={{ marginBottom: 4, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, color: t.inkMuted, fontWeight: 500, marginBottom: 4 }}>Win condition</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.ink }}>
                    {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
                    {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: t.ink, marginLeft: 6, padding: "2px 6px", borderRadius: 6, background: t.inkGhost, border: `0.5px solid ${t.hair}` }}>custom</span>}
                  </div>
                </div>

                <button onClick={() => setShowAdvanced(v => !v)} style={{
                  width: "100%", padding: "10px 0", border: "none", background: "none",
                  fontSize: 13, color: t.inkMuted, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}>
                  <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
                  Advanced settings
                </button>

                <Collapse open={showAdvanced} maxH={400}>
                  <div style={{ background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "14px", marginTop: 4, marginBottom: 16 }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{wc.lineLen}{customLineLen !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
                      </div>
                      <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                        onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{wc.linesNeeded}{customLinesNeeded !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
                      </div>
                      <input type="range" min={1} max={5} value={wc.linesNeeded}
                        onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Turn timer</div>
                        <button onClick={() => setTimerEnabled(v => !v)} style={{
                          width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                          background: timerEnabled ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: "50%", background: timerEnabled ? t.bg1 : t.ink, position: "absolute", top: 1,
                            left: timerEnabled ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                          }} />
                        </button>
                      </div>
                      <Collapse open={timerEnabled} maxH={120}>
                        <div style={{ paddingBottom: 2 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: t.inkMuted }}>Seconds per turn</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{timerSeconds}s</span>
                          </div>
                          <input type="range" min={5} max={60} step={5} value={timerSeconds}
                            onChange={e => setTimerSeconds(+e.target.value)}
                            style={{ width: "100%", cursor: "pointer" }} />
                        </div>
                      </Collapse>
                    </div>
                    {(customLineLen !== null || customLinesNeeded !== null) && (
                      <button className="btn-hover" onClick={() => { setCustomLineLen(null); setCustomLinesNeeded(null); }} style={{
                        width: "100%", padding: 8, borderRadius: 10, border: `0.5px solid ${t.hair}`,
                        background: t.glassFillSolid, fontSize: 12, color: t.inkMuted, cursor: "pointer",
                        fontFamily: "inherit", marginTop: 10,
                      }}>Reset to default</button>
                    )}
                  </div>
                </Collapse>

                <button className="btn-hover" onClick={startGame} disabled={!opponentJoined || hasDupes} style={{
                  width: "100%", padding: 14, borderRadius: 14, border: `0.5px solid ${t.ink}`, fontSize: 15, fontWeight: 600,
                  cursor: (opponentJoined && !hasDupes) ? "pointer" : "default",
                  background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0",
                  fontFamily: "inherit", opacity: (opponentJoined && !hasDupes) ? 1 : 0.4,
                  boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                  transition: "opacity 0.15s",
                }}>
                  {opponentJoined ? "Start Game" : "Waiting for opponent..."}
                </button>
              </>
            )}

            {/* Guest: waiting for host to start */}
            {!isHost && status === "connected" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 14, color: t.inkMuted }}>
                  {opponentJoined ? "Waiting for host to start..." : "Connecting..."}
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%", background: t.ink,
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      </div>
    </>
  );
}

function Tutorial({ onClose }) {
  const t = useTheme();
  const [step, setStep] = useState(0);
  const steps = [
    { title: "Welcome to Mega Tic Tac Toe", body: "Classic 3-in-a-row, reimagined on a huge grid. Play locally, vs AI, or online with friends." },
    { title: "Big Grids", body: "Grids go up to 20×20. You need to complete multiple lines (e.g. 5 lines of 5) to win — so every move matters across the whole board." },
    { title: "Scoring", body: "Each completed line counts toward your target. Scored cells stay on the board but can't be reused. Race your opponent to hit the line count first." },
    { title: "Powers Mode", body: "Optional mode where each player picks a power: Takeover (steal a tile), Block (temporary denial area), Teleport (move one tile), Double Place (two tiles every 3rd turn). Powers have cooldowns." },
    { title: "You're Ready", body: "Try a small 7×7 grid first, then scale up. Have fun!" },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "modalFadeIn 0.22s ease-out" }}>
      <div style={{
        background: t.glassFillStrong,
        backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
        border: `0.5px solid ${t.glassBorder}`,
        borderRadius: 22, padding: "28px 24px", maxWidth: 380, width: "100%",
        boxShadow: t.glassShadow, animation: "modalCardIn 0.32s cubic-bezier(0.16,1,0.3,1)",
      }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? t.ink : t.hair, transition: "background 0.3s" }} />
          ))}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: t.ink, marginBottom: 10, letterSpacing: "-0.02em" }}>{s.title}</h2>
        <p style={{ fontSize: 14, color: t.inkMuted, lineHeight: 1.5, marginBottom: 24 }}>{s.body}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 13, color: t.inkMuted, cursor: "pointer", fontFamily: "inherit", padding: "8px 4px" }}>Skip</button>
          <button className="btn-hover" onClick={() => last ? onClose() : setStep(step + 1)} style={{ padding: "10px 24px", borderRadius: 12, border: `0.5px solid ${t.ink}`, fontSize: 14, fontWeight: 600, cursor: "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0", fontFamily: "inherit" }}>
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_HERO_GRID = 20;
function HeroShapeGrid({ gridSize = 12, playerCount = 2, mode = "normal", staticBackdrop = false }) {
  const t = useTheme();
  const containerRef = useRef(null);
  const cellRefs = useRef([]);
  const cols = gridSize, rows = gridSize;
  const [cellPx, setCellPx] = useState(48);
  const [flourish, setFlourish] = useState(null);

  // Always render MAX_HERO_GRID × MAX_HERO_GRID cells so add/remove animates smoothly.
  // Each cell has a stable hashed shape index. Visibility & shape are gated by props.
  const allCells = useMemo(() => {
    const out = [];
    for (let r = 0; r < MAX_HERO_GRID; r++) {
      for (let c = 0; c < MAX_HERO_GRID; c++) {
        const h = (r * 2654435761 + c * 40503) >>> 0;
        out.push({ r, c, hash: h });
      }
    }
    return out;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setCellPx(Math.max(12, Math.min(rect.width / cols, rect.height / rows)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [cols, rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (staticBackdrop) {
      // Just paint static base opacity once; no cursor reaction, no rAF loop.
      cellRefs.current.forEach(el => {
        if (!el) return;
        const visible = el.dataset.visible === "1";
        if (!visible) { el.style.opacity = "0"; el.style.transform = "scale(0.6)"; return; }
        el.style.opacity = "0.05";
        el.style.transform = "scale(0.88)";
      });
      return;
    }
    let x = -9999, y = -9999;
    let raf = 0;
    let running = true;
    const tick = () => {
      const rect = container.getBoundingClientRect();
      const cw = rect.width / cols, ch = rect.height / rows;
      const radius = Math.max(cw, ch) * 3.6;
      cellRefs.current.forEach((el) => {
        if (!el) return;
        const visible = el.dataset.visible === "1";
        const r = +el.dataset.r;
        const c = +el.dataset.c;
        const flourishOp = +el.dataset.flourishOp || 0;
        if (!visible) {
          el.style.opacity = "0";
          el.style.transform = "scale(0.6)";
          return;
        }
        const cx = (c + 0.5) * cw;
        const cy = (r + 0.5) * ch;
        const d = Math.hypot(cx - x, cy - y);
        const intensity = Math.max(0, 1 - d / radius);
        const baseOp = +el.dataset.baseOp || 0.05;
        const op = Math.max(flourishOp, baseOp + intensity * 0.75);
        el.style.opacity = op.toFixed(3);
        el.style.transform = `scale(${0.88 + intensity * 0.28 + flourishOp * 0.15})`;
      });
      if (running) raf = requestAnimationFrame(tick);
    };
    const onMove = (e) => {
      const r = container.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
    };
    const onLeave = () => { x = -9999; y = -9999; };
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(raf); container.removeEventListener("pointermove", onMove); container.removeEventListener("pointerleave", onLeave); };
  }, [cols, rows, staticBackdrop]);

  useEffect(() => {
    if (staticBackdrop) return;
    if (reducedMotion()) return;
    let to;
    const pickLine = () => {
      const len = Math.min(5, cols);
      if (cols < 2) return [];
      const dir = Math.floor(Math.random() * 4); // 0 row, 1 col, 2 diag-dr, 3 diag-dl
      let r0, c0, dr, dc;
      if (dir === 0) { r0 = Math.floor(Math.random() * rows); c0 = Math.floor(Math.random() * (cols - len + 1)); dr = 0; dc = 1; }
      else if (dir === 1) { r0 = Math.floor(Math.random() * (rows - len + 1)); c0 = Math.floor(Math.random() * cols); dr = 1; dc = 0; }
      else if (dir === 2) { r0 = Math.floor(Math.random() * (rows - len + 1)); c0 = Math.floor(Math.random() * (cols - len + 1)); dr = 1; dc = 1; }
      else { r0 = Math.floor(Math.random() * (rows - len + 1)); c0 = Math.floor(Math.random() * (cols - len + 1)) + (len - 1); dr = 1; dc = -1; }
      const pts = [];
      for (let i = 0; i < len; i++) pts.push([r0 + dr * i, c0 + dc * i]);
      return pts;
    };
    const trigger = () => {
      const pts = pickLine();
      const playerIdx = Math.floor(Math.random() * Math.max(1, playerCount));
      setFlourish({ pts, playerIdx, id: Date.now() });
      setTimeout(() => setFlourish(null), 1500);
      to = setTimeout(trigger, 5200 + Math.random() * 3200);
    };
    to = setTimeout(trigger, 2400);
    return () => clearTimeout(to);
  }, [rows, cols, playerCount, staticBackdrop]);

  const flourishSet = useMemo(() => {
    const s = new Set();
    if (flourish) flourish.pts.forEach(([r, c]) => s.add(r * MAX_HERO_GRID + c));
    return s;
  }, [flourish]);

  return (
    <div ref={containerRef} style={{
      position: "relative", width: "100%", height: "100%", minHeight: 0,
      overflow: "hidden", borderRadius: 22,
      background: `radial-gradient(ellipse 80% 70% at 30% 40%, ${t.glassFill} 0%, transparent 70%)`,
    }}>
      {allCells.map((m) => {
        const i = m.r * MAX_HERO_GRID + m.c;
        const visible = m.r < rows && m.c < cols;
        const isF = visible && flourishSet.has(i);
        const playerIdx = isF ? flourish.playerIdx : (m.hash % Math.max(1, playerCount));
        const player = PLAYERS[playerIdx];
        const size = Math.max(10, Math.floor(cellPx * 0.58));
        return (
          <div
            key={i}
            ref={el => cellRefs.current[i] = el}
            data-base-op={isF ? 0.9 : 0.05}
            data-flourish-op={isF ? 0.9 : 0}
            data-visible={visible ? "1" : "0"}
            data-r={m.r}
            data-c={m.c}
            style={{
              position: "absolute",
              left: `${(m.c / cols) * 100}%`,
              top: `${(m.r / rows) * 100}%`,
              width: `${100 / cols}%`,
              height: `${100 / rows}%`,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.05,
              transform: "scale(0.88)",
              transition: "left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1), width 0.55s cubic-bezier(0.22,1,0.36,1), height 0.55s cubic-bezier(0.22,1,0.36,1), opacity 0.35s ease-out, transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
              pointerEvents: "none",
              color: t.ink,
            }}
          >
            <PlayerMark player={player} size={size} tone={t.ink} bg={t.bg1} />
          </div>
        );
      })}
    </div>
  );
}

function Setup({ onStart, onOnline, onStats, onSettings, onResume, dark, setDark }) {
  const hasSaved = (() => {
    try { return !!JSON.parse(localStorage.getItem("mtt-saved-game") || "null"); }
    catch { return false; }
  })();
  // PWA install prompt
  const [installEvent, setInstallEvent] = useState(null);
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallEvent(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const installApp = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch {}
    setInstallEvent(null);
  };
  const t = useTheme();
  const [showTutorial, setShowTutorial] = useState(() => !localStorage.getItem("mtt-tutorial-seen"));
  const closeTutorial = () => { localStorage.setItem("mtt-tutorial-seen", "1"); setShowTutorial(false); };
  // Hydrate from localStorage (last-used config) if available
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem("mtt-setup-config") || "null") || {}; }
    catch { return {}; }
  })();
  const [mode, setMode] = useState(saved.mode || "normal");
  const [gridSize, setGridSize] = useState(saved.gridSize ?? 12);
  const [playerCount, setPlayerCount] = useState(saved.playerCount ?? 2);
  const [powers, setPowers] = useState(saved.powers || [0, 1, 2, 3]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLineLen, setCustomLineLen] = useState(saved.customLineLen ?? null);
  const [customLinesNeeded, setCustomLinesNeeded] = useState(saved.customLinesNeeded ?? null);
  const [timerEnabled, setTimerEnabled] = useState(saved.timerEnabled ?? false);
  const [timerSeconds, setTimerSeconds] = useState(saved.timerSeconds ?? 15);
  const [vsAI, setVsAI] = useState(saved.vsAI ?? false);
  const [aiDifficulty, setAiDifficulty] = useState(saved.aiDifficulty || "medium");
  const [teams, setTeams] = useState(saved.teams ?? false);
  // Persist on every change
  useEffect(() => {
    try {
      localStorage.setItem("mtt-setup-config", JSON.stringify({
        mode, gridSize, playerCount, powers, customLineLen, customLinesNeeded,
        timerEnabled, timerSeconds, vsAI, aiDifficulty, teams,
      }));
    } catch {}
  }, [mode, gridSize, playerCount, powers, customLineLen, customLinesNeeded, timerEnabled, timerSeconds, vsAI, aiDifficulty, teams]);
  const autoWc = getWinConditions(gridSize, playerCount);
  const wc = {
    lineLen: customLineLen ?? autoWc.lineLen,
    linesNeeded: customLinesNeeded ?? autoWc.linesNeeded,
  };
  const usedPowers = powers.slice(0, playerCount);
  const hasDupes = mode === "powers" && new Set(usedPowers).size < usedPowers.length;
  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 960);
  useEffect(() => {
    const on = () => setIsWide(window.innerWidth >= 960);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const gearIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.14.68.36.94.65.26.29.45.64.55 1.02.04.15.06.31.06.47" />
    </svg>
  );

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: isWide ? "40px 56px" : 20, userSelect: "none" }}>
      {showTutorial && <Tutorial onClose={closeTutorial} />}
      <div style={{
        width: "100%", maxWidth: isWide ? 1200 : 440,
        display: "grid", gridTemplateColumns: isWide ? "1.1fr 1fr" : "1fr",
        gap: isWide ? 64 : 0, alignItems: "stretch",
        animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {isWide && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28, minHeight: 620 }}>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <button onClick={() => setShowTutorial(true)} title="How to play" style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7 }}>?</button>
            </div>
            <div>
              <h1 style={{ fontSize: "clamp(48px, 5.4vw, 72px)", fontWeight: 800, letterSpacing: "-0.045em", color: t.ink, lineHeight: 0.92 }}>Mega<br />Tic Tac Toe</h1>
              <p style={{ fontSize: 16, color: t.inkMuted, marginTop: 18, maxWidth: 420, lineHeight: 1.5 }}>
                Strategy at scale. Bigger grids, more players, and a shape-based signature for every opponent.
              </p>
            </div>
            <div style={{ flex: 1, minHeight: 260 }}>
              <HeroShapeGrid gridSize={gridSize} playerCount={playerCount} mode={mode} />
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", maxWidth: isWide ? 460 : "none", marginLeft: isWide ? 0 : "auto", marginRight: isWide ? 0 : "auto" }}>
        {!isWide && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setShowTutorial(true)} title="How to play" style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7 }}>?</button>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", textAlign: "center", color: t.ink }}>Mega Tic Tac Toe</h1>
            <button onClick={onSettings} title="Settings" aria-label="Settings" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{gearIcon}</button>
          </div>
        )}
        {isWide && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <button onClick={onSettings} title="Settings" aria-label="Settings" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: t.inkMuted, opacity: 0.7, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{gearIcon}</button>
          </div>
        )}
        {!isWide && <p style={{ fontSize: 14, color: t.inkMuted, textAlign: "center", marginTop: 6 }}>Customise your game</p>}
        {isWide && <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.8px", textTransform: "uppercase" }}>Customise your game</div>}

        <div style={{ marginTop: isWide ? 20 : 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
          <div style={{ display: "flex", background: t.inkGhost, borderRadius: 12, padding: 3, gap: 2, border: `0.5px solid ${t.hair}` }}>
            {["normal", "powers"].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "8px 0", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 500,
                cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                background: mode === m ? t.glassFillSolid : "transparent",
                color: mode === m ? t.ink : t.inkMuted,
                boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}>{m === "normal" ? "Normal" : "Powers"}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
            <span key={gridSize} style={{ fontSize: 20, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums", animation: "scoreBump 0.2s ease-out" }}>{gridSize}×{gridSize}</span>
          </div>
          <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.inkFaint, marginTop: 2 }}>
            <span>7×7</span><span>20×20</span>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setPlayerCount(n)} style={{
                width: 48, height: 48, borderRadius: 12, fontSize: 18, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
                border: playerCount === n ? `0.5px solid ${t.hairStrong}` : `0.5px solid ${t.hair}`,
                background: playerCount === n ? t.inkGhost : t.glassFillSolid,
                color: playerCount === n ? t.ink : t.inkMuted,
              }}>{n}</button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  display: "flex",
                  transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s",
                  transform: i < playerCount ? "scale(1)" : "scale(0)",
                  opacity: i < playerCount ? 1 : 0,
                }}>
                  <PlayerMark player={PLAYERS[i]} size={18} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {playerCount === 4 && (
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Team mode</div>
              <div style={{ fontSize: 13, color: t.inkMuted, marginTop: 2 }}>{teams ? "Circle + Square vs Triangle + Diamond" : "Free-for-all"}</div>
            </div>
            <button onClick={() => setTeams(v => !v)} style={{
              width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
              background: teams ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", background: teams ? t.bg1 : t.ink, position: "absolute", top: 1,
                left: teams ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
              }} />
            </button>
          </div>
        )}

        {playerCount === 2 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Opponent</div>
                <div style={{ fontSize: 13, color: t.inkMuted, marginTop: 2 }}>{vsAI ? "Play vs AI" : "Local multiplayer"}</div>
              </div>
              <button onClick={() => setVsAI(v => !v)} style={{
                width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                background: vsAI ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", background: vsAI ? t.bg1 : t.ink, position: "absolute", top: 1,
                  left: vsAI ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                }} />
              </button>
            </div>
            <Collapse open={vsAI} maxH={80}>
              <div style={{ display: "flex", background: t.inkGhost, borderRadius: 12, padding: 3, gap: 2, marginTop: 10, border: `0.5px solid ${t.hair}` }}>
                {["easy", "medium", "hard"].map(d => (
                  <button key={d} onClick={() => setAiDifficulty(d)} style={{
                    flex: 1, padding: "7px 0", borderRadius: 10, border: "none", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
                    background: aiDifficulty === d ? t.glassFillSolid : "transparent",
                    color: aiDifficulty === d ? t.ink : t.inkMuted,
                    boxShadow: aiDifficulty === d ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                  }}>{d}</button>
                ))}
              </div>
            </Collapse>
          </div>
        )}

        <Collapse open={mode === "powers"} maxH={300}>
          <div style={{ marginTop: 22, paddingBottom: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Assign powers</div>
            {Array.from({ length: playerCount }).map((_, pi) => (
              <div key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: t.glassFillSolid, borderRadius: 12, padding: "8px 12px", marginBottom: 6, border: `0.5px solid ${t.hair}` }}>
                <PlayerMark player={PLAYERS[pi]} size={16} />
                <span style={{ fontSize: 13, fontWeight: 500, width: 60, flexShrink: 0, color: t.ink }}>{PLAYERS[pi].name}</span>
                <select value={powers[pi]} onChange={e => { const p = [...powers]; p[pi] = +e.target.value; setPowers(p); }}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 10, border: `0.5px solid ${t.hair}`, fontSize: 13, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink }}>
                  {POWERS.map((pw, wi) => <option key={wi} value={wi}>{pw.icon} {pw.name}</option>)}
                </select>
              </div>
            ))}
            {hasDupes && <p style={{ fontSize: 12, color: "#C8544A", marginTop: 4 }}>Each player should have a unique power</p>}
          </div>
        </Collapse>

        <div style={{ marginTop: 22, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: t.inkMuted, fontWeight: 500, marginBottom: 4 }}>Win condition</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.ink }}>
            {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
            {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: t.ink, marginLeft: 6, padding: "2px 6px", borderRadius: 6, background: t.inkGhost, border: `0.5px solid ${t.hair}` }}>custom</span>}
          </div>
        </div>

        <button onClick={() => setShowAdvanced(v => !v)} style={{
          width: "100%", padding: "10px 0", border: "none", background: "none",
          fontSize: 13, color: t.inkMuted, cursor: "pointer", fontFamily: "inherit",
          marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
          Advanced settings
        </button>

        <Collapse open={showAdvanced} maxH={400}>
          <div style={{ background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "14px", marginTop: 4 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums", transition: "color 0.2s" }}>{wc.lineLen}{customLineLen !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
              </div>
              <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.inkFaint, marginTop: 2 }}>
                <span>3</span><span>{Math.min(gridSize, 8)}</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums", transition: "color 0.2s" }}>{wc.linesNeeded}{customLinesNeeded !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
              </div>
              <input type="range" min={1} max={5} value={wc.linesNeeded}
                onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.inkFaint, marginTop: 2 }}>
                <span>1</span><span>5</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Turn timer</div>
                <button onClick={() => setTimerEnabled(v => !v)} style={{
                  width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                  background: timerEnabled ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", background: timerEnabled ? t.bg1 : t.ink, position: "absolute", top: 1,
                    left: timerEnabled ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                  }} />
                </button>
              </div>
              <Collapse open={timerEnabled} maxH={120}>
                <div style={{ paddingBottom: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: t.inkMuted }}>Seconds per turn</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{timerSeconds}s</span>
                  </div>
                  <input type="range" min={5} max={60} step={5} value={timerSeconds}
                    onChange={e => setTimerSeconds(+e.target.value)}
                    style={{ width: "100%", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.inkFaint, marginTop: 2 }}>
                    <span>5s</span><span>60s</span>
                  </div>
                </div>
              </Collapse>
            </div>
            {(customLineLen !== null || customLinesNeeded !== null) && (
              <button className="btn-hover" onClick={() => { setCustomLineLen(null); setCustomLinesNeeded(null); }} style={{
                width: "100%", padding: 8, borderRadius: 10, border: `0.5px solid ${t.hair}`,
                background: t.glassFillSolid, fontSize: 12, color: t.inkMuted, cursor: "pointer",
                fontFamily: "inherit", marginTop: 10,
              }}>Reset to default</button>
            )}
          </div>
        </Collapse>

        {hasSaved && onResume && (
          <button className="btn-hover" onClick={onResume} style={{
            width: "100%", padding: 12, borderRadius: 14, border: `0.5px solid ${t.hairStrong}`, fontSize: 14, fontWeight: 600,
            cursor: "pointer", background: t.glassFill, color: t.ink,
            backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
            fontFamily: "inherit", marginTop: 18,
          }}>Resume last game</button>
        )}
        <button className="btn-hover" onClick={() => !hasDupes && onStart({ mode, gridSize, playerCount, powers: powers.slice(0, playerCount), ...wc, timer: timerEnabled ? timerSeconds : 0, ai: vsAI && playerCount === 2, aiDifficulty, teams: teams && playerCount === 4 })}
          style={{
            width: "100%", padding: 14, borderRadius: 14, border: `0.5px solid ${t.ink}`, fontSize: 15, fontWeight: 600,
            cursor: hasDupes ? "default" : "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0",
            fontFamily: "inherit", marginTop: 24, opacity: hasDupes ? 0.4 : 1,
            boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            transition: "opacity 0.15s, transform 0.12s, box-shadow 0.12s",
          }}>Start Game</button>
        <button className="btn-hover" onClick={onOnline}
          style={{
            width: "100%", padding: 14, borderRadius: 14, border: `0.5px solid ${t.hairStrong}`, fontSize: 15, fontWeight: 600,
            cursor: "pointer", background: t.glassFill, color: t.ink,
            backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
            fontFamily: "inherit", marginTop: 10,
            transition: "transform 0.12s, box-shadow 0.12s",
          }}>Play Online</button>
        {installEvent && (
          <button className="btn-hover" onClick={installApp} style={{
            width: "100%", padding: 10, borderRadius: 12, border: `0.5px solid ${t.hair}`, fontSize: 13, fontWeight: 500,
            cursor: "pointer", background: t.glassFillSolid, color: t.inkMuted,
            fontFamily: "inherit", marginTop: 8,
          }}>Install app</button>
        )}
        <button className="btn-hover" onClick={onStats}
          style={{
            width: "100%", padding: 10, borderRadius: 12, border: "none", fontSize: 13,
            cursor: "pointer", background: "transparent", color: t.inkMuted,
            fontFamily: "inherit", marginTop: 6,
          }}>View Stats</button>
        </div>
      </div>
      </div>
    </>
  );
}

function Board({ board, onCellClick, lastMove, lastMoves = [], winCells, currentPlayer, actionMode, zoom, onZoom, ghostOwner, blocks = [], globalTurn = 1, tpSource = null, cursor = null, linePickCells = null }) {
  const t = useTheme();
  const n = board.length;
  const cellSize = Math.max(28, zoom);
  const gap = 1;
  const containerRef = useRef(null);
  const pinchRef = useRef(null);

  useEffect(() => {
    if (lastMove && containerRef.current) {
      const el = containerRef.current;
      const [r, c] = lastMove;
      const x = c * (cellSize + gap) + cellSize / 2 - el.clientWidth / 2;
      const y = r * (cellSize + gap) + cellSize / 2 - el.clientHeight / 2;
      el.scrollTo({ left: x, top: y, behavior: "smooth" });
    }
  }, [lastMove, cellSize]);

  // Pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        // Midpoint in container-local coords (for re-centering)
        const rect = el.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        // Board-space point under the midpoint, at current zoom
        const boardX = el.scrollLeft + mx;
        const boardY = el.scrollTop + my;
        pinchRef.current = { dist: Math.hypot(dx, dy), zoom, mx, my, boardX, boardY };
      }
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scale = dist / pinchRef.current.dist;
        const newZoom = Math.min(72, Math.max(20, pinchRef.current.zoom * scale));
        const ratio = newZoom / pinchRef.current.zoom;
        onZoom(newZoom);
        // Re-center so the board-space point under the midpoint stays put
        const newScrollLeft = pinchRef.current.boardX * ratio - pinchRef.current.mx;
        const newScrollTop = pinchRef.current.boardY * ratio - pinchRef.current.my;
        // Defer to next frame so the new cellSize is applied before scroll
        requestAnimationFrame(() => {
          el.scrollLeft = newScrollLeft;
          el.scrollTop = newScrollTop;
        });
      }
    };
    const onTouchEnd = () => { pinchRef.current = null; };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [zoom, onZoom]);

  const winSet = new Set(winCells.map(([r,c]) => `${r},${c}`));
  const linePickSet = linePickCells ? new Set(linePickCells.map(([r, c]) => `${r},${c}`)) : null;

  // Minimap
  const miniRef = useRef(null);
  const [miniState, setMiniState] = useState({ show: false, sl: 0, st: 0, sw: 0, sh: 0, cw: 0, ch: 0 });
  const [miniCorner, setMiniCorner] = useState(() => {
    try { return localStorage.getItem("mtt-mini-corner") || "br"; } catch { return "br"; }
  });
  const [miniDrag, setMiniDrag] = useState(null); // { x, y, dx, dy } while dragging
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const overflows = el.scrollWidth > el.clientWidth + 10 || el.scrollHeight > el.clientHeight + 10;
      setMiniState({
        show: overflows, sl: el.scrollLeft, st: el.scrollTop,
        sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight,
      });
    };
    update();
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [cellSize]);

  useEffect(() => {
    if (!miniState.show || !miniRef.current) return;
    const canvas = miniRef.current;
    const miniSize = 90;
    canvas.width = miniSize; canvas.height = miniSize;
    const ctx = canvas.getContext("2d");
    const px = miniSize / n;
    ctx.fillStyle = t.grid;
    ctx.fillRect(0, 0, miniSize, miniSize);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (cell && cell.wall) ctx.fillStyle = t.cellWall;
      else if (cell && !cell.wall && cell.visible !== false) ctx.fillStyle = PLAYERS[cell.owner].fill;
      else ctx.fillStyle = t.cell;
      ctx.fillRect(c * px + 0.5, r * px + 0.5, px - 1, px - 1);
    }
    // Viewport rect — use scrollWidth/scrollHeight to account for flex centering
    const { sl, st, sw, sh, cw, ch } = miniState;
    const vx = (sl / sw) * miniSize;
    const vy = (st / sh) * miniSize;
    const vw = (cw / sw) * miniSize;
    const vh = (ch / sh) * miniSize;
    ctx.strokeStyle = "rgba(74,123,247,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, vy, Math.min(vw, miniSize), Math.min(vh, miniSize));
  }, [miniState, board, n, t]);

  const onMiniClick = useCallback((e) => {
    if (e.defaultPrevented) return;
    const el = containerRef.current;
    if (!el || !miniRef.current) return;
    const rect = miniRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    el.scrollTo({
      left: mx * el.scrollWidth - el.clientWidth / 2,
      top: my * el.scrollHeight - el.clientHeight / 2,
      behavior: "smooth",
    });
  }, []);

  // Drag-to-move minimap. Below 6px movement = treated as click (scroll-to).
  const onMiniPointerDown = useCallback((e) => {
    if (!miniRef.current) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const rect = miniRef.current.getBoundingClientRect();
    const offX = startX - rect.left, offY = startY - rect.top;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 6) moved = true;
      if (moved) {
        setMiniDrag({ x: ev.clientX - offX, y: ev.clientY - offY });
      }
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved) return; // let click handler scroll
      const cx = ev.clientX - offX + rect.width / 2;
      const cy = ev.clientY - offY + rect.height / 2;
      const vw = window.innerWidth, vh = window.innerHeight;
      const corner =
        cx < vw / 2 && cy < vh / 2 ? "tl" :
        cx >= vw / 2 && cy < vh / 2 ? "tr" :
        cx < vw / 2 ? "bl" : "br";
      setMiniCorner(corner);
      try { localStorage.setItem("mtt-mini-corner", corner); } catch {}
      setMiniDrag(null);
      // Suppress the synthetic click that follows drag.
      const block = (ce) => { ce.preventDefault(); ce.stopPropagation(); window.removeEventListener("click", block, true); };
      window.addEventListener("click", block, true);
      setTimeout(() => window.removeEventListener("click", block, true), 200);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div ref={containerRef} style={{
      flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "8px 12px 12px", minHeight: 0, background: "transparent", position: "relative",
    }}>
      {miniState.show && (() => {
        const margin = 12, miniW = 90, miniH = 90;
        const cornerStyle = miniDrag ? {
          left: miniDrag.x, top: miniDrag.y,
          transition: "none",
        } : {
          left: miniCorner === "tl" || miniCorner === "bl" ? margin : "auto",
          right: miniCorner === "tr" || miniCorner === "br" ? margin : "auto",
          top: miniCorner === "tl" || miniCorner === "tr" ? 70 : "auto",
          bottom: miniCorner === "bl" || miniCorner === "br" ? 70 : "auto",
          transition: "left 0.35s cubic-bezier(0.22,1,0.36,1), right 0.35s cubic-bezier(0.22,1,0.36,1), top 0.35s cubic-bezier(0.22,1,0.36,1), bottom 0.35s cubic-bezier(0.22,1,0.36,1)",
        };
        return (
          <div style={{
            position: "fixed", width: miniW, height: miniH,
            zIndex: 40, ...cornerStyle,
            animation: miniDrag ? undefined : "miniIn 0.3s cubic-bezier(0.16,1,0.3,1)",
            touchAction: "none",
          }}>
            <canvas ref={miniRef} onClick={onMiniClick} onPointerDown={onMiniPointerDown}
              title="Drag to move · click to jump"
              style={{
                width: "100%", height: "100%", display: "block",
                borderRadius: 14, border: `0.5px solid ${miniDrag ? t.hairStrong : t.glassBorder}`,
                background: t.glassFillStrong,
                backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)",
                boxShadow: miniDrag ? `0 8px 28px rgba(0,0,0,0.22)` : t.glassShadow,
                cursor: miniDrag ? "grabbing" : "grab",
                transform: miniDrag ? "scale(1.06)" : "scale(1)",
                transition: miniDrag ? "transform 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out" : "transform 0.2s ease-out, box-shadow 0.2s ease-out, border-color 0.2s ease-out",
              }}
            />
            {/* Drag handle dots — top-right corner of the minimap */}
            <svg width="14" height="14" viewBox="0 0 14 14" style={{
              position: "absolute", top: 4, right: 4, pointerEvents: "none",
              opacity: miniDrag ? 0.95 : 0.55,
              transition: "opacity 0.2s",
            }}>
              <circle cx="3" cy="3" r="1.1" fill={t.ink} />
              <circle cx="7" cy="3" r="1.1" fill={t.ink} />
              <circle cx="11" cy="3" r="1.1" fill={t.ink} />
              <circle cx="3" cy="7" r="1.1" fill={t.ink} />
              <circle cx="7" cy="7" r="1.1" fill={t.ink} />
              <circle cx="11" cy="7" r="1.1" fill={t.ink} />
            </svg>
          </div>
        );
      })()}
      <div style={{ position: "relative", flexShrink: 0,
        background: t.glassFill,
        backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
        border: `0.5px solid ${t.glassBorder}`, boxShadow: t.glassShadow,
        borderRadius: 22, padding: 10,
      }}>
      <div key={`pulse-${currentPlayer}`} style={{
        position: "absolute", inset: 0, borderRadius: 22, pointerEvents: "none",
        boxShadow: `inset 0 0 24px 2px ${t.ink}`,
        animation: "turnGlow 0.95s cubic-bezier(0.22,1,0.36,1) forwards", opacity: 0,
      }} />
      {/* Cell grid lines — gives each cell a visible boundary */}
      <div style={{
        position: "absolute", inset: 10, borderRadius: 14, pointerEvents: "none",
        backgroundImage:
          `linear-gradient(to right, ${t.hairStrong} 1px, transparent 1px),` +
          `linear-gradient(to bottom, ${t.hairStrong} 1px, transparent 1px)`,
        backgroundSize: `${cellSize + gap}px ${cellSize + gap}px`,
        backgroundPosition: "0 0",
      }} />
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${n}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${n}, ${cellSize}px)`,
        gap, background: "transparent", borderRadius: 6, flexShrink: 0, position: "relative",
        animation: "boardIn 0.4s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {board.map((row, r) => row.map((cell, c) => {
          const isWall = cell && cell.wall;
          const isGhost = cell && cell.visible === false;
          const owned = cell && !cell.wall && cell.visible !== false;
          const isScored = owned && cell.scored;
          const color = owned ? PLAYERS[cell.owner] : null;
          const won = winSet.has(`${r},${c}`);
          const last = lastMove && lastMove[0] === r && lastMove[1] === c;
          const showGhost = isGhost && cell.owner === ghostOwner;
          const stealTarget = actionMode === "takeover" && cell && !cell.wall && cell.visible !== false && !cell.scored && cell.owner !== currentPlayer;
          const cellBlocked = isBlocked(blocks, r, c, globalTurn);
          // Teleport: if no source picked, own non-scored tiles clickable; otherwise empty cells clickable
          const tpSrcPick = actionMode === "teleport" && !tpSource && cell && cell.owner === currentPlayer && !cell.wall && !cell.scored && cell.visible !== false && !cellBlocked;
          const tpDstPick = actionMode === "teleport" && tpSource && !cell && !cellBlocked;
          const isTpSource = tpSource && tpSource[0] === r && tpSource[1] === c;
          const blockAnchorPick = actionMode === "block" && !cell;

          const clickable = (!cell && !actionMode && !cellBlocked) || stealTarget || blockAnchorPick || tpSrcPick || tpDstPick;

          // Last-move trail: newest first, older = more faded
          const trailIdx = lastMoves.findIndex(([mr, mc]) => mr === r && mc === c);
          const linePick = linePickSet && linePickSet.has(`${r},${c}`);

          return (
            <div key={`${r}-${c}`} className={clickable ? "cell" : undefined} onClick={() => onCellClick(r, c)} style={{
              width: cellSize, height: cellSize,
              background: cellBlocked ? t.cellWall : (isWall ? t.cellWall : "transparent"),
              borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: clickable ? "pointer" : "default",
              position: "relative", transition: "background 0.2s",
            }}>
              {cellBlocked && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 4,
                  backgroundImage: `repeating-linear-gradient(45deg, ${t.hair} 0 3px, transparent 3px 7px)`,
                  pointerEvents: "none",
                }} />
              )}
              {trailIdx > 0 && owned && (
                <div style={{
                  position: "absolute", inset: 2, borderRadius: "50%",
                  boxShadow: `0 0 0 1.5px ${t.ink}${trailIdx === 1 ? "55" : "22"}`,
                  pointerEvents: "none",
                }} />
              )}
              {cursor && cursor[0] === r && cursor[1] === c && (
                <div style={{
                  position: "absolute", inset: -2, borderRadius: 6,
                  border: `1.5px solid ${t.ink}`,
                  boxShadow: `0 0 0 2px ${t.inkGhost}`,
                  pointerEvents: "none",
                }} />
              )}
              {isTpSource && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: "50%",
                  border: `1.5px dashed ${t.ink}`,
                  animation: "slideUp 0.2s ease-out",
                  pointerEvents: "none",
                }} />
              )}
              {clickable && !cell && (
                <>
                  <div className="cell-hover" style={{
                    position: "absolute", inset: 2, borderRadius: 4, transition: "background 0.15s",
                  }} />
                  <div className="hover-dot" style={{
                    position: "absolute", inset: cellSize * 0.2,
                    opacity: 0, transform: "scale(0.6)",
                    transition: "opacity 0.18s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)", pointerEvents: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <PlayerMark player={PLAYERS[currentPlayer]} size={cellSize * 0.6} />
                  </div>
                </>
              )}
              {isWall && (
                <svg width={cellSize * 0.45} height={cellSize * 0.45} viewBox="0 0 20 20"
                  style={{ opacity: 0.35, animation: cell.anim === "wall" ? "wallDrop 0.35s ease-out" : undefined }}>
                  <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
              {owned && (
                <div style={{
                  width: cellSize * 0.78, height: cellSize * 0.78,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: isScored ? 0.75 : 1,
                  animation: won ? `winPulse 0.6s ease-in-out infinite`
                    : cell.anim === "score" ? `popIn 0.3s cubic-bezier(0.34,1.56,0.64,1)`
                    : cell.anim === "steal" ? `popIn 0.3s cubic-bezier(0.34,1.56,0.64,1), stealFlash 0.4s ease-out`
                    : cell.anim === "reveal" ? `revealPop 0.4s cubic-bezier(0.34,1.56,0.64,1)`
                    : last ? "glassPop 0.42s cubic-bezier(0.34,1.56,0.64,1)" : undefined,
                  filter: won ? `drop-shadow(0 0 6px ${t.inkGhost})` : undefined,
                  transition: "opacity 0.3s",
                }}>
                  <PlayerMark player={color} size={cellSize * 0.78} scored={isScored} winning={won} />
                </div>
              )}
              {showGhost && (
                <div style={{
                  width: cellSize * 0.55, height: cellSize * 0.55,
                  opacity: 0.35, display: "flex", alignItems: "center", justifyContent: "center",
                  animation: cell.anim === "ghost" ? "ghostFade 0.3s ease-out" : undefined,
                }}>
                  <PlayerMark player={PLAYERS[cell.owner]} size={cellSize * 0.55} />
                </div>
              )}
              {isGhost && !showGhost && (
                <div style={{ width: cellSize * 0.2, height: cellSize * 0.2, borderRadius: "50%", background: t.hairStrong }} />
              )}
              {stealTarget && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: 4,
                  border: `1.5px solid ${t.ink}`, background: t.inkGhost,
                  animation: "slideUp 0.2s ease-out",
                }} />
              )}
              {linePick && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 4,
                  border: `1.5px dashed ${t.hairStrong}`,
                  pointerEvents: "none",
                  opacity: 0.85,
                }} />
              )}
            </div>
          );
        }))}
      </div>
      </div>
    </div>
  );
}


export default function MegaTicTacToe() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = THEMES[dark ? "dark" : "light"];
  const [screen, setScreen] = useState(() => {
    // Deep-link: ?room=CODE → open online lobby directly
    try {
      const code = new URL(window.location.href).searchParams.get("room");
      if (code && /^[A-Z0-9]{4}$/i.test(code)) return "online-lobby";
    } catch {}
    return "setup";
  }); // setup | game | review | online-lobby | online-game | online-review
  const [config, setConfig] = useState(null);
  const [board, setBoard] = useState([]);
  const [cp, setCp] = useState(0);
  const [turn, setTurn] = useState(1);
  const [globalTurn, setGlobalTurn] = useState(1);
  const [scores, setScores] = useState({});
  const [cooldowns, setCooldowns] = useState({});
  const [playerTurns, setPlayerTurns] = useState({});
  const [lastMove, setLastMove] = useState(null);
  const [winCells, setWinCells] = useState([]);
  const [winner, setWinner] = useState(null);
  const [isDraw, setIsDraw] = useState(false);
  const [pwr, setPwr] = useState({ active: false, used: false, firstDone: false, tpSource: null });
  const [blocks, setBlocks] = useState([]); // active block areas: [{r,c,size,expiresAt,owner}]
  const [lastMoves, setLastMoves] = useState([]); // trail of recent moves: [[r,c], ...] newest first
  const [cursor, setCursor] = useState(null); // keyboard cursor [r,c] or null
  const [replayIdx, setReplayIdx] = useState(null); // review: history index being shown, null = final
  const handleClickRef = useRef(null);
  const [zoom, setZoom] = useState(44);
  const zoomRef = useRef(44);
  const zoomTweenRef = useRef(null);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const tweenZoom = useCallback((delta) => {
    if (zoomTweenRef.current) cancelAnimationFrame(zoomTweenRef.current);
    const from = zoomRef.current;
    const target = Math.min(72, Math.max(20, from + delta));
    if (target === from) return;
    const start = performance.now();
    const duration = 220;
    const ease = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setZoom(from + (target - from) * ease(t));
      if (t < 1) zoomTweenRef.current = requestAnimationFrame(step);
    };
    zoomTweenRef.current = requestAnimationFrame(step);
  }, []);

  // Keyboard + scroll-wheel zoom shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); tweenZoom(8); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); tweenZoom(-8); return; }
      // Board keyboard nav (arrow keys + Enter/Space)
      const b = boardRef.current;
      const n = b && b.length;
      if (!n) return;
      const move = (dr, dc) => {
        setCursor(cur => {
          const [r, c] = cur || [Math.floor(n/2), Math.floor(n/2)];
          return [Math.max(0, Math.min(n-1, r+dr)), Math.max(0, Math.min(n-1, c+dc))];
        });
      };
      if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0); }
      else if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); move(0, 1); }
      else if (e.key === "Enter" || e.key === " ") {
        if (!cursor) return;
        e.preventDefault();
        handleClickRef.current?.(cursor[0], cursor[1]);
      }
    };
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      tweenZoom(e.deltaY > 0 ? -6 : 6);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [tweenZoom]);
  const [msg, setMsg] = useState(null);
  const [history, setHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerLockout, setTimerLockout] = useState(false);
  const timerRef = useRef(null);
  const turnCooldownUntilRef = useRef(0);

  // Online multiplayer state
  const [onlineConn, setOnlineConn] = useState(null);
  const [onlineSlot, setOnlineSlot] = useState(-1);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [forfeitedSlots, setForfeitedSlots] = useState([]);
  const [spectators, setSpectators] = useState([]); // [{name}]
  const [graceTimers, setGraceTimers] = useState({}); // { [slot]: { name, until } }
  const [graceTick, setGraceTick] = useState(0);
  const [connState, setConnState] = useState("connected"); // connected | reconnecting
  const [emoteFeed, setEmoteFeed] = useState([]); // [{id, slot, name, emote, at}]
  const [rematchVote, setRematchVote] = useState({ votedSlots: [], needed: 0, count: 0 });
  const onlineConnRef = useRef(null);
  /** Longer-than-needed line: player must pick a contiguous segment (sync with server `pendingLinePick`). */
  const [pendingLinePick, setPendingLinePick] = useState(null);

  const toast = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(null), 1600); }, []);

  // Grace countdown ticker
  useEffect(() => {
    if (Object.keys(graceTimers).length === 0) return;
    const id = setInterval(() => setGraceTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [graceTimers]);

  // Track a rolling trail of the last 3 moves (newest first) for the move-trail visual
  useEffect(() => {
    if (!lastMove) return;
    setLastMoves(prev => {
      const [pr, pc] = lastMove;
      // Skip if same as newest (avoids dup on re-renders)
      if (prev[0] && prev[0][0] === pr && prev[0][1] === pc) return prev;
      return [[pr, pc], ...prev].slice(0, 3);
    });
    sfx.place();
    haptic.place();
  }, [lastMove]);

  // Score / win sound + haptic cues
  const prevScoresRef = useRef({});
  useEffect(() => {
    const prev = prevScoresRef.current;
    let scored = false;
    for (const k of Object.keys(scores || {})) {
      if ((scores[k] || 0) > (prev[k] || 0)) { scored = true; break; }
    }
    if (scored) { sfx.score(); haptic.score(); }
    prevScoresRef.current = { ...scores };
  }, [scores]);

  useEffect(() => {
    if (winner !== null || isDraw) { sfx.win(); haptic.win(); }
  }, [winner, isDraw]);

  // Saved game: snapshot local (non-AI, non-online) game state so it can be resumed.
  useEffect(() => {
    if (screen !== "game") return;
    if (!config || config.ai) return; // skip AI games (opponent move is state-dependent)
    if (winner !== null || isDraw) return;
    try {
      const snap = {
        config, board, cp, turn, globalTurn, scores, cooldowns, playerTurns,
        blocks, lastMove, lastMoves, pwr: { ...pwr, active: false, firstDone: false, tpSource: null },
        savedAt: Date.now(),
      };
      localStorage.setItem("mtt-saved-game", JSON.stringify(snap));
    } catch {}
  }, [screen, config, board, cp, turn, globalTurn, scores, cooldowns, playerTurns, blocks, lastMove, lastMoves, pwr, winner, isDraw]);

  // Clear saved game on win/draw
  useEffect(() => {
    if (winner !== null || isDraw) {
      try { localStorage.removeItem("mtt-saved-game"); } catch {}
    }
  }, [winner, isDraw]);

  // Render the current board + banner into a canvas, then try to share or download.
  const shareSnapshot = useCallback(async () => {
    if (!board || !board.length || !config) return;
    const n = board.length;
    const cell = 28;
    const pad = 20;
    const headerH = 60;
    const w = n * cell + pad * 2;
    const h = n * cell + pad * 2 + headerH;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    // bg
    ctx.fillStyle = dark ? "#1e1e20" : "#F7F6F3";
    ctx.fillRect(0, 0, w, h);
    // header
    ctx.fillStyle = dark ? "#ffffff" : "#222";
    ctx.font = "bold 20px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    const title = isDraw ? "It's a draw!" : (winner !== null ? `${PLAYERS[winner].name} wins!` : "Mega Tic Tac Toe");
    ctx.fillText(title, w / 2, 28);
    ctx.font = "12px -apple-system, system-ui, sans-serif";
    ctx.fillStyle = dark ? "#999" : "#666";
    const scoreStr = Object.keys(scores).sort().map(k => `${PLAYERS[k].name}: ${scores[k]}`).join("   ");
    ctx.fillText(scoreStr || `${n}×${n} • ${config.lineLen} in a row`, w / 2, 48);
    // board bg
    ctx.fillStyle = dark ? "#2a2a2d" : "#ffffff";
    ctx.fillRect(pad - 4, headerH + pad - 4, n * cell + 8, n * cell + 8);
    // grid lines
    ctx.strokeStyle = dark ? "#3a3a3e" : "#e3e3e1";
    ctx.lineWidth = 1;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(pad + i * cell, headerH + pad);
      ctx.lineTo(pad + i * cell, headerH + pad + n * cell);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, headerH + pad + i * cell);
      ctx.lineTo(pad + n * cell, headerH + pad + i * cell);
      ctx.stroke();
    }
    // tiles
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const t = board[r][c];
      if (!t || t.visible === false) continue;
      const color = PLAYERS[t.owner];
      const x = pad + c * cell + cell / 2;
      const y = headerH + pad + r * cell + cell / 2;
      ctx.fillStyle = color.fill;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
      ctx.fill();
      if (t.scored) {
        ctx.strokeStyle = color.fill;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // footer
    ctx.fillStyle = dark ? "#666" : "#aaa";
    ctx.font = "10px -apple-system, system-ui, sans-serif";
    ctx.fillText("Mega Tic Tac Toe", w / 2, h - 6);

    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (!blob) return;
    const file = new File([blob], "mega-ttt-board.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Mega TTT board" });
        return;
      }
    } catch {}
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast("Board image copied to clipboard");
        return;
      }
    } catch {}
    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "mega-ttt-board.png"; a.click();
    URL.revokeObjectURL(url);
  }, [board, config, scores, winner, isDraw, dark, toast]);

  const resumeGame = useCallback(() => {
    try {
      const snap = JSON.parse(localStorage.getItem("mtt-saved-game") || "null");
      if (!snap || !snap.config || !snap.board) return;
      setConfig(snap.config);
      setBoard(snap.board);
      setCp(snap.cp || 0);
      setTurn(snap.turn || 1);
      setGlobalTurn(snap.globalTurn || 1);
      setScores(snap.scores || {});
      setCooldowns(snap.cooldowns || {});
      setPlayerTurns(snap.playerTurns || {});
      setLastMove(snap.lastMove || null);
      setLastMoves(snap.lastMoves || []);
      setBlocks(snap.blocks || []);
      setPwr({ active: false, used: false, firstDone: false, tpSource: null });
      setWinner(null); setIsDraw(false); setWinCells([]);
      setMsg(null); setHistory([]); setRedoHistory([]); setReplayIdx(null);
      setTimeLeft(snap.config.timer || 0);
      setTimerLockout(false);
      const vw = Math.min(window.innerWidth - 32, 600);
      setZoom(Math.min(52, Math.max(22, Math.floor(vw / snap.config.gridSize))));
      setScreen("game");
    } catch {}
  }, []);

  const startGame = useCallback((cfg) => {
    setConfig(cfg);
    setBoard(makeBoard(cfg.gridSize));
    setCp(0); setTurn(1); setGlobalTurn(1);
    setScores({}); setCooldowns({}); setPlayerTurns({}); setLastMove(null);
    setWinCells([]); setWinner(null); setIsDraw(false);
    setPwr({ active: false, used: false, firstDone: false, tpSource: null });
    setBlocks([]); setLastMoves([]);
    setMsg(null); setHistory([]); setRedoHistory([]); setReplayIdx(null);
    setTimeLeft(cfg.timer || 0);
    setTimerLockout(false);
    setPendingLinePick(null);
    const vw = Math.min(window.innerWidth - 32, 600);
    setZoom(Math.min(52, Math.max(22, Math.floor(vw / cfg.gridSize))));
    setScreen("game");
  }, []);

  // Online: receive server state and apply it
  const applyOnlineState = useCallback((msg) => {
    if (msg.config) setConfig(msg.config);
    if (msg.board) setBoard(msg.board);
    if (msg.cp !== undefined) setCp(msg.cp);
    if (msg.turn !== undefined) setTurn(msg.turn);
    if (msg.globalTurn !== undefined) setGlobalTurn(msg.globalTurn);
    if (msg.scores) setScores(msg.scores);
    if (msg.cooldowns) setCooldowns(msg.cooldowns);
    if (msg.playerTurns) setPlayerTurns(msg.playerTurns);
    if (msg.lastMove !== undefined) setLastMove(msg.lastMove);
    if (msg.winner !== undefined) setWinner(msg.winner);
    if (msg.isDraw !== undefined) setIsDraw(msg.isDraw);
    if (msg.winCells) setWinCells(msg.winCells);
    if (msg.pwr) setPwr({ tpSource: null, ...msg.pwr });
    if (msg.blocks) setBlocks(msg.blocks);
    if (msg.timeLeft !== undefined) { setTimeLeft(msg.timeLeft); if (msg.timeLeft > 0) setTimerLockout(false); }
    if (msg.you !== undefined) setOnlineSlot(msg.you);
    if (msg.players) {
      setOnlinePlayers(msg.players);
      // Clear grace timers for any players who are now connected
      setGraceTimers(prev => {
        const next = { ...prev };
        for (const p of msg.players) {
          if (!p.disconnected && next[p.slot] !== undefined) delete next[p.slot];
        }
        return next;
      });
    }
    if (msg.forfeitedSlots) setForfeitedSlots(msg.forfeitedSlots);
    if (msg.spectators !== undefined) setSpectators(msg.spectators);
    if (msg.pendingLinePick !== undefined) setPendingLinePick(msg.pendingLinePick);

    if (msg.config?.gridSize) {
      const vw = Math.min(window.innerWidth - 32, 600);
      setZoom(Math.min(52, Math.max(22, Math.floor(vw / msg.config.gridSize))));
    }

    if (msg.phase === "playing") { setScreen("online-game"); setRematchVote({ votedSlots: [], needed: 0, count: 0 }); }
    else if (msg.phase === "review") setScreen("online-review");
    else if (msg.phase === "lobby") setScreen("online-lobby");
  }, []);

  const handleOnlineGameStart = useCallback((connection, msg) => {
    onlineConnRef.current = connection;
    setOnlineConn(connection);
    setHistory([]);
    setMsg(null);
    setGraceTimers({});
    setForfeitedSlots([]);
    applyOnlineState(msg);
    try {
      const u = new URL(window.location.href);
      const room = u.searchParams.get("room");
      if (room) localStorage.setItem("mtt-last-room", room.toUpperCase());
    } catch {}
  }, [applyOnlineState]);

  // Online: set up message listener when connection changes
  useEffect(() => {
    if (!onlineConn) return;
    const handler = (msg) => {
      if (msg.type === "timer-tick") {
        setTimeLeft(msg.timeLeft);
        return;
      }
      if (msg.type === "opponent-disconnected") {
        toast("Opponent disconnected");
        return;
      }
      if (msg.type === "player-grace") {
        toast(`${msg.name || "Player " + (msg.slot + 1)} disconnected — grace period`);
        setGraceTimers(prev => ({ ...prev, [msg.slot]: { name: msg.name, until: msg.graceUntil } }));
        return;
      }
      if (msg.type === "player-forfeited") {
        toast(`${msg.name || "Player " + (msg.slot + 1)} forfeited`);
        setForfeitedSlots(prev => prev.includes(msg.slot) ? prev : [...prev, msg.slot]);
        setGraceTimers(prev => { const next = { ...prev }; delete next[msg.slot]; return next; });
        return;
      }
      if (msg.type === "player-joined") {
        setOnlinePlayers(prev => {
          if (prev.find(p => p.slot === msg.slot)) {
            return prev.map(p => p.slot === msg.slot ? { ...p, name: msg.name, disconnected: false } : p);
          }
          return [...prev, { slot: msg.slot, name: msg.name, disconnected: false }];
        });
        setGraceTimers(prev => { const next = { ...prev }; delete next[msg.slot]; return next; });
        toast(`${msg.name} joined`);
        return;
      }
      if (msg.type === "player-left") {
        if (msg.slot >= 0) {
          setOnlinePlayers(prev => prev.map(p => p.slot === msg.slot ? { ...p, disconnected: true } : p));
        }
        toast(`${msg.name || "Player " + (msg.slot + 1)} left`);
        return;
      }
      if (msg.type === "error") {
        toast(msg.message);
        return;
      }
      if (msg.type === "host-migrated") {
        toast(`${msg.newHostName} is now the host`);
        return;
      }
      if (msg.type === "rematch-vote") {
        setRematchVote({ votedSlots: msg.votedSlots || [], needed: msg.needed || 0, count: msg.count || 0 });
        return;
      }
      if (msg.type === "emote") {
        const id = Math.random().toString(36).slice(2);
        setEmoteFeed(prev => [...prev, { id, slot: msg.slot, name: msg.name, emote: msg.emote, at: msg.at || Date.now() }]);
        setTimeout(() => setEmoteFeed(prev => prev.filter(e => e.id !== id)), 3500);
        return;
      }
      if (msg.type === "spectator-joined") {
        toast(`${msg.name} is watching`);
        setSpectators(prev => prev.find(s => s.name === msg.name) ? prev : [...prev, { name: msg.name }]);
        return;
      }
      if (msg.type === "spectator-renamed") {
        setSpectators(prev => prev.map(s => s.name === msg.oldName ? { name: msg.name } : s));
        return;
      }
      // Full state updates
      if (msg.phase !== undefined || msg.board !== undefined || msg.players !== undefined || msg.spectators !== undefined) {
        applyOnlineState(msg);
      }
    };

    // Re-add the handler (replaces the lobby handler)
    const wsHandler = (e) => {
      try { handler(JSON.parse(e.data)); } catch {}
    };
    onlineConn.ws.addEventListener("message", wsHandler);
    const onOpen = () => setConnState("connected");
    const onDown = () => setConnState("reconnecting");
    onlineConn.ws.addEventListener("open", onOpen);
    onlineConn.ws.addEventListener("close", onDown);
    onlineConn.ws.addEventListener("error", onDown);
    setConnState(onlineConn.ws.readyState === 1 ? "connected" : "reconnecting");
    return () => {
      onlineConn.ws.removeEventListener("message", wsHandler);
      onlineConn.ws.removeEventListener("open", onOpen);
      onlineConn.ws.removeEventListener("close", onDown);
      onlineConn.ws.removeEventListener("error", onDown);
    };
  }, [onlineConn, applyOnlineState, toast]);

  // Record game stats when entering review screen
  const recordedRef = useRef(null);
  useEffect(() => {
    if (screen !== "review" && screen !== "online-review") {
      recordedRef.current = null;
      return;
    }
    // Avoid double-recording the same game
    const key = `${screen}-${globalTurn}-${winner}-${isDraw}`;
    if (recordedRef.current === key) return;
    recordedRef.current = key;

    const isOnlineGame = screen === "online-review";
    const mode = isOnlineGame ? "online" : config?.ai ? "ai" : "local";
    let result;
    if (isDraw) {
      result = "draw";
    } else if (mode === "online") {
      result = winner === onlineSlot ? "win" : "loss";
    } else if (mode === "ai") {
      result = winner === 0 ? "win" : "loss";
    } else {
      // local: player 0 winning counts as "win"
      result = winner === 0 ? "win" : "loss";
    }
    recordGame({ mode, result, gridSize: config?.gridSize });
  }, [screen, winner, isDraw, config, onlineSlot, globalTurn]);

  const teamsArr = useMemo(() => (config?.teams ? [[0, 2], [1, 3]] : null), [config?.teams]);

  const afterFirstScoreEndTurn = useCallback((newBoard, newCd, sScores) => {
    for (let p = 0; p < config.playerCount; p++) {
      if ((sScores[p] || 0) >= config.linesNeeded) {
        const allScored = [];
        for (let r = 0; r < newBoard.length; r++) for (let c = 0; c < newBoard[r].length; c++) {
          if (newBoard[r][c]?.owner === p && newBoard[r][c]?.scored) allScored.push([r, c]);
        }
        setBoard(newBoard); setScores(sScores); setWinner(p);
        setWinCells(allScored);
        setScreen("review"); return;
      }
    }
    let full = true;
    outer: for (let r = 0; r < newBoard.length; r++) for (let c = 0; c < newBoard[0].length; c++) if (!newBoard[r][c]) { full = false; break outer; }
    if (full) { setBoard(newBoard); setScores(sScores); setIsDraw(true); setScreen("review"); return; }

    const next = (cp + 1) % config.playerCount;
    const nextGT = globalTurn + 1;
    const nextRound = next === 0 ? turn + 1 : turn;
    const cd = { ...newCd }; if (cd[next] > 0) cd[next]--;
    const revealed = revealGhosts(newBoard, nextRound);
    const s2 = scoreAndMark(revealed, config.playerCount, config.lineLen, sScores, teamsArr);
    if (s2.pending) {
      setBoard(revealed);
      setScores(s2.scores);
      setPendingLinePick({ pending: s2.pending, resume: "endTurnSecond", extra: { cd, next, nextGT } });
      return;
    }
    for (let p = 0; p < config.playerCount; p++) {
      if ((s2.scores[p] || 0) >= config.linesNeeded) {
        const allScored = [];
        for (let r = 0; r < revealed.length; r++) for (let c = 0; c < revealed[r].length; c++) {
          if (revealed[r][c]?.owner === p && revealed[r][c]?.scored) allScored.push([r, c]);
        }
        setBoard(revealed); setScores(s2.scores); setWinner(p);
        setWinCells(allScored);
        setScreen("review"); return;
      }
    }
    setBoard(revealed); setScores(s2.scores); setCooldowns(cd);
    setPlayerTurns(pt => ({ ...pt, [cp]: (pt[cp] || 0) + 1 }));
    turnCooldownUntilRef.current = Date.now() + 600; // prevent double-tap on next player
    setCp(next); setGlobalTurn(nextGT);
    if (next === 0) setTurn(t => t + 1);
    setPwr({ active: false, used: false, firstDone: false, tpSource: null });
    setBlocks(bs => pruneBlocks(bs, nextGT));
    if (config.timer) setTimeLeft(config.timer);
  }, [config, cp, globalTurn, turn, teamsArr]);

  const endTurn = useCallback((newBoard, newCd) => {
    const s = scoreAndMark(newBoard, config.playerCount, config.lineLen, scores, teamsArr);
    if (s.pending) {
      setBoard(newBoard);
      setScores(s.scores);
      setPendingLinePick({ pending: s.pending, resume: "endTurnFirst", extra: { newCd } });
      return;
    }
    afterFirstScoreEndTurn(newBoard, newCd, s.scores);
  }, [config, scores, teamsArr, afterFirstScoreEndTurn]);

  const pendingLinePickRef = useRef(null);
  useEffect(() => { pendingLinePickRef.current = pendingLinePick; }, [pendingLinePick]);

  const boardRef = useRef(board);
  const scoresRef = useRef(scores);
  boardRef.current = board;
  scoresRef.current = scores;

  const continueLinePick = useCallback((offset) => {
    const pl = pendingLinePickRef.current;
    if (!pl) return;
    const b = cloneBoard(boardRef.current);
    let r = applyPendingLineScore(b, config.playerCount, config.lineLen, pl.pending, offset, scoresRef.current, teamsArr);
    while (r.pending) {
      if (config.ai && r.pending.playerIds.includes(1)) {
        r = applyPendingLineScore(b, config.playerCount, config.lineLen, r.pending, 0, r.scores, teamsArr);
      } else {
        setBoard(b);
        setScores(r.scores);
        setPendingLinePick({ pending: r.pending, resume: pl.resume, extra: pl.extra });
        return;
      }
    }
    setBoard(b);
    setScores(r.scores);
    setPendingLinePick(null);
    const resume = pl.resume;
    if (resume === "endTurnFirst") {
      afterFirstScoreEndTurn(b, pl.extra.newCd, r.scores);
    } else if (resume === "endTurnSecond") {
      const { cd, next, nextGT } = pl.extra;
      for (let p = 0; p < config.playerCount; p++) {
        if ((r.scores[p] || 0) >= config.linesNeeded) {
          const allScored = [];
          for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++) {
            if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) allScored.push([ri, ci]);
          }
          setWinner(p); setWinCells(allScored);
          setScreen("review"); return;
        }
      }
      setCooldowns(cd);
      setPlayerTurns(pt => ({ ...pt, [cp]: (pt[cp] || 0) + 1 }));
      setCp(next); setGlobalTurn(nextGT);
      if (next === 0) setTurn(t => t + 1);
      setPwr({ active: false, used: false, firstDone: false, tpSource: null });
      setBlocks(bs => pruneBlocks(bs, nextGT));
      if (config.timer) setTimeLeft(config.timer);
    } else if (resume === "doublePlace") {
      for (let p = 0; p < config.playerCount; p++) {
        if ((r.scores[p] || 0) >= config.linesNeeded) {
          const allScored = [];
          for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++) {
            if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) allScored.push([ri, ci]);
          }
          setWinner(p); setWinCells(allScored);
          setScreen("review"); return;
        }
      }
      setPwr({ active: false, used: false, firstDone: true, tpSource: null });
    } else if (resume === "powerFirst") {
      for (let p = 0; p < config.playerCount; p++) {
        if ((r.scores[p] || 0) >= config.linesNeeded) {
          const allScored = [];
          for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++) {
            if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) allScored.push([ri, ci]);
          }
          setWinner(p); setWinCells(allScored);
          setScreen("review"); return;
        }
      }
      setPwr(pwr => ({ ...pwr, firstDone: true }));
    }
  }, [config, teamsArr, afterFirstScoreEndTurn, cp, config?.timer]);

  const continueLinePickRef = useRef(continueLinePick);
  continueLinePickRef.current = continueLinePick;

  useEffect(() => {
    if (!pendingLinePick || !config?.ai) return;
    if (!pendingLinePick.pending.playerIds.includes(1)) return;
    const id = setTimeout(() => continueLinePickRef.current(0), 450);
    return () => clearTimeout(id);
  }, [pendingLinePick, config?.ai]);

  // Turn timer countdown — only depends on screen/cp/config to avoid restarts
  const cooldownsRef = useRef(cooldowns);
  const endTurnRef = useRef(endTurn);
  const pwrRef = useRef(pwr);
  const playerTurnsRef = useRef(playerTurns);
  const blocksRef = useRef(blocks);
  cooldownsRef.current = cooldowns;
  endTurnRef.current = endTurn;
  pwrRef.current = pwr;
  playerTurnsRef.current = playerTurns;
  blocksRef.current = blocks;

  useEffect(() => {
    if (!config?.timer || screen !== "game" || pendingLinePick) return;
    const id = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(id);
          setTimerLockout(true);
          setTimeout(() => {
            const b = boardRef.current;
            const empty = [];
            for (let r = 0; r < b.length; r++) for (let c = 0; c < b[0].length; c++) {
              if (b[r][c]) continue;
              if (isBlocked(blocksRef.current, r, c, globalTurn)) continue;
              empty.push([r,c]);
            }
            if (empty.length > 0) {
              const [r, c] = empty[Math.floor(Math.random() * empty.length)];
              setPwr({ active: false, used: false, firstDone: false });
              const nb = b.map(row => row.map(x => x ? {...x} : null));
              nb[r][c] = { owner: cp, visible: true }; setLastMove([r,c]);
              setBoard(nb);
              endTurnRef.current(nb, { ...cooldownsRef.current });
              toast("Time's up! Random tile placed");
            }
            setTimeout(() => setTimerLockout(false), 2000);
          }, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen, cp, config, toast, pendingLinePick]);

  // AI auto-play (handles normal tiles + powers)
  useEffect(() => {
    if (screen !== "game" || !config?.ai || cp !== 1) return;
    const isPow = config.mode === "powers";
    const power = isPow ? POWERS[config.powers[1]] : null;
    const delay = 900 + Math.random() * 500; // slower, more human-like
    const id = setTimeout(() => {
      const board = boardRef.current;
      const curPwr = pwrRef.current;

      // Step 2: execute power action after first tile was placed
      if (isPow && curPwr.active && curPwr.firstDone && power && power.id !== "doublePlace") {
        const move = aiPickPowerAction(board, 1, power.id, config.lineLen, config.playerCount, blocksRef.current, globalTurn);
        if (!move) return;
        if (power.id === "takeover") {
          const [r, c] = move;
          const b = cloneBoard(board);
          b[r][c] = { owner: 1, visible: true, anim: "steal" };
          setBoard(b); setLastMove([r, c]);
          endTurnRef.current(b, { ...cooldownsRef.current, 1: getPowerCd("takeover", config.gridSize) });
        } else if (power.id === "block") {
          const [r, c] = move;
          const size = getBlockSize(config.lineLen);
          const expiresAt = globalTurn + 3 * config.playerCount;
          setBlocks(bs => [...bs, { r, c, size, expiresAt, owner: 1, createdAt: globalTurn }]);
          endTurnRef.current(board, { ...cooldownsRef.current, 1: power.cd });
        } else if (power.id === "teleport") {
          const { from, to } = move;
          const b = cloneBoard(board);
          b[to[0]][to[1]] = { ...b[from[0]][from[1]], anim: "reveal" };
          b[from[0]][from[1]] = null;
          setBoard(b); setLastMove(to);
          endTurnRef.current(b, { ...cooldownsRef.current, 1: power.cd });
        }
        return;
      }

      // Decide to use power this turn
      const diff = config.aiDifficulty || "medium";
      const cd = cooldownsRef.current[1] || 0;
      const canUse = isPow && cd === 0 && !curPwr.used && power && power.id !== "doublePlace";

      // Pick and place normal tile (step 1) — difficulty-aware wrapper
      let move;
      if (diff === "easy" && Math.random() < 0.55) {
        // Easy: often pick a random empty non-blocked cell
        const empties = [];
        for (let r = 0; r < board.length; r++) for (let c = 0; c < board.length; c++) {
          if (!board[r][c] && !isBlocked(blocksRef.current, r, c, globalTurn)) empties.push([r, c]);
        }
        move = empties.length ? empties[Math.floor(Math.random() * empties.length)] : null;
      } else if (diff === "hard") {
        move = aiPickMoveHard(board, 1, config.lineLen, config.playerCount, blocksRef.current, globalTurn);
      } else {
        move = aiPickMove(board, 1, config.lineLen, config.playerCount, blocksRef.current, globalTurn);
      }
      if (!move) return;
      const [r, c] = move;
      const b = cloneBoard(board);
      b[r][c] = { owner: 1, visible: true };

      // Power usage is value-driven, not random; thresholds vary by difficulty.
      let willUse = false;
      if (canUse) {
        const plan = aiPlanPowerAction(b, 1, power.id, config.lineLen, config.playerCount, blocksRef.current, globalTurn);
        const ownTiles = b.flat().filter(cell => cell && cell.owner === 1 && !cell.wall && cell.visible !== false && !cell.scored).length;
        const minScore = {
          easy: { takeover: 220, block: 210, teleport: 34 },
          medium: { takeover: 120, block: 110, teleport: 18 },
          hard: { takeover: 70, block: 70, teleport: 8 },
        };
        const scoreReq = (minScore[diff] || minScore.medium)[power.id] ?? 180;
        const earlyTeleport = power.id === "teleport" && ownTiles < 3;
        const teleportEarlyReq = 300;
        const urgentScore = power.id === "takeover" ? 8000 : 6000;
        if (plan && plan.action && plan.score >= scoreReq) {
          if (plan.score >= urgentScore || !earlyTeleport || plan.score >= teleportEarlyReq) {
            willUse = true;
          }
        }
      }
      setLastMove([r, c]);
      setHistory(h => [...h, {
        board: cloneBoard(board),
        cp: 1, turn, globalTurn, scores: { ...scoresRef.current }, cooldowns: { ...cooldownsRef.current },
        playerTurns: { ...playerTurnsRef.current }, lastMove, undoPlayer: 1,
      }]);

      // Double Place: 2nd tile every 3rd turn (same rule as for humans)
      const isDouble = isPow && power?.id === "doublePlace" && ((playerTurnsRef.current[1] || 0) + 1) % 3 === 0;
      if (isDouble && !curPwr.firstDone) {
        const s = flushScorePending(b, config.playerCount, config.lineLen, scoresRef.current, config.teams ? [[0, 2], [1, 3]] : null);
        setBoard(b); setScores(s);
        for (let p = 0; p < config.playerCount; p++) {
          if ((s[p] || 0) >= config.linesNeeded) {
            const cells = [];
            for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++)
              if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) cells.push([ri, ci]);
            setWinner(p); setWinCells(cells); setScreen("review");
            return;
          }
        }
        setPwr({ active: false, used: false, firstDone: true });
        return;
      }

      // Takeover/Block/Teleport: place normal tile, queue step 2
      if (willUse) {
        const s = flushScorePending(b, config.playerCount, config.lineLen, scoresRef.current, config.teams ? [[0, 2], [1, 3]] : null);
        setBoard(b); setScores(s);
        for (let p = 0; p < config.playerCount; p++) {
          if ((s[p] || 0) >= config.linesNeeded) {
            const cells = [];
            for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++)
              if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) cells.push([ri, ci]);
            setWinner(p); setWinCells(cells); setScreen("review");
            return;
          }
        }
        setPwr({ active: true, used: true, firstDone: true });
        return;
      }

      // Normal move
      setBoard(b);
      endTurnRef.current(b, { ...cooldownsRef.current });
    }, delay);
    return () => clearTimeout(id);
  }, [screen, cp, config, turn, globalTurn, pwr, lastMove]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const snap = history[history.length - 1];
    // Save current state for redo
    setRedoHistory(rh => [...rh, {
      board: board.map(row => row.map(x => x ? { ...x } : null)),
      cp, turn, globalTurn,
      scores: { ...scores },
      cooldowns: { ...cooldowns },
      playerTurns: { ...playerTurns },
      lastMove, undoPlayer: snap.undoPlayer,
    }]);
    setHistory(h => h.slice(0, -1));
    setBoard(snap.board); setCp(snap.cp); setTurn(snap.turn);
    setGlobalTurn(snap.globalTurn); setScores(snap.scores);
    setCooldowns(snap.cooldowns); setPlayerTurns(snap.playerTurns);
    setLastMove(snap.lastMove); setWinCells([]); setWinner(null);
    setIsDraw(false); setPwr({ active: false, used: false, firstDone: false });
    setPendingLinePick(null);
    setScreen("game"); setMsg(null);
    toast(`Undid ${PLAYERS[snap.undoPlayer].name}'s move`);
  }, [history, toast, board, cp, turn, globalTurn, scores, cooldowns, playerTurns, lastMove]);

  const redo = useCallback(() => {
    if (redoHistory.length === 0) return;
    const snap = redoHistory[redoHistory.length - 1];
    setRedoHistory(rh => rh.slice(0, -1));
    // Save current state back into history for undo chain
    setHistory(h => [...h, {
      board: board.map(row => row.map(x => x ? { ...x } : null)),
      cp, turn, globalTurn,
      scores: { ...scores },
      cooldowns: { ...cooldowns },
      playerTurns: { ...playerTurns },
      lastMove, undoPlayer: snap.undoPlayer,
    }]);
    setBoard(snap.board); setCp(snap.cp); setTurn(snap.turn);
    setGlobalTurn(snap.globalTurn); setScores(snap.scores);
    setCooldowns(snap.cooldowns); setPlayerTurns(snap.playerTurns);
    setLastMove(snap.lastMove); setWinCells([]); setWinner(null);
    setIsDraw(false); setPwr({ active: false, used: false, firstDone: false });
    setPendingLinePick(null);
    setScreen("game"); setMsg(null);
    toast(`Redid ${PLAYERS[snap.undoPlayer].name}'s move`);
  }, [redoHistory, board, cp, turn, globalTurn, scores, cooldowns, playerTurns, lastMove, toast]);

  const handleClick = useCallback((r, c) => {
    // Online mode: send move to server
    if (screen === "online-game") {
      if (pendingLinePick) {
        if (canPickLineSlot(pendingLinePick.pending, onlineSlot)) toast("Use the buttons to choose your line");
        else toast("Waiting for line choice");
        return;
      }
      if (cp !== onlineSlot) { toast("Opponent's turn"); return; }
      if (onlineConnRef.current) onlineConnRef.current.move(r, c);
      return;
    }
    if (screen !== "game") return;
    if (timerLockout) { toast("Timer expired — wait a moment"); return; }
    if (Date.now() < turnCooldownUntilRef.current) return; // silently ignore double taps
    if (pendingLinePick) { toast("Choose which segment counts for your line"); return; }
    if (config.ai && cp === 1) return; // AI's turn, ignore clicks
    const cell = board[r][c];
    const isPow = config.mode === "powers";
    const power = isPow ? POWERS[config.powers[cp]] : null;

    // Save snapshot on first action of a turn (not step 2)
    if (!pwr.firstDone) {
      setRedoHistory([]); // new branch, clear redo
      setHistory(h => [...h, {
        board: board.map(row => row.map(x => x ? { ...x } : null)),
        cp, turn, globalTurn, scores: { ...scores }, cooldowns: { ...cooldowns },
        playerTurns: { ...playerTurns }, lastMove, undoPlayer: cp,
      }]);
    }

    // Step 2 of Takeover/Block/Teleport: special action after normal tile
    if (pwr.active && pwr.firstDone && power?.id === "takeover") {
      if (!cell || cell.wall || cell.owner === cp || cell.visible === false || cell.scored) { toast("Pick an opponent's tile"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { owner: cp, visible: true, anim: "steal" }; setBoard(b); setLastMove([r,c]);
      endTurn(b, { ...cooldowns, [cp]: getPowerCd("takeover", config.gridSize) }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "block") {
      const size = getBlockSize(config.lineLen);
      if (r + size > config.gridSize || c + size > config.gridSize) { toast(`Block must fit on the board (${size}×${size})`); return; }
      // Overlap with existing active block: disallow (keeps things readable)
      for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
        if (isBlocked(blocks, r + dr, c + dc, globalTurn)) { toast("Overlaps an existing block"); return; }
      }
      // Duration: 3 of THIS player's turns → expire when next time this player would play again + 3
      // Simpler: expire after 3 × playerCount global turns from now (≈ 3 of this player's cycles).
      const expiresAt = globalTurn + 3 * config.playerCount;
      setBlocks(bs => [...bs, { r, c, size, expiresAt, owner: cp, createdAt: globalTurn }]);
      endTurn(board, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "teleport") {
      // Two-click UX: first click selects a source (own, non-scored, non-wall, not blocked), second selects destination.
      if (!pwr.tpSource) {
        if (!cell || cell.owner !== cp || cell.wall || cell.scored || cell.visible === false) { toast("Pick one of your tiles to move"); return; }
        if (isBlocked(blocks, r, c, globalTurn)) { toast("That tile is inside a blocked area"); return; }
        setPwr({ ...pwr, tpSource: [r, c] });
        toast("Now pick where to move it");
        return;
      }
      // Second click: destination
      if (cell) { toast("Destination must be empty"); return; }
      if (isBlocked(blocks, r, c, globalTurn)) { toast("Can't teleport into a blocked area"); return; }
      const [sr, sc] = pwr.tpSource;
      if (sr === r && sc === c) { toast("Pick a different cell"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      const moved = { ...b[sr][sc], anim: "reveal" };
      b[sr][sc] = null;
      b[r][c] = moved;
      setBoard(b); setLastMove([r, c]);
      endTurn(b, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }

    // Step 1 for all powers (and normal mode): place normal tile
    if (cell) return;
    if (isBlocked(blocks, r, c, globalTurn)) { toast("That area is currently blocked"); return; }
    const b = board.map(row => row.map(x => x ? {...x} : null));
    b[r][c] = { owner: cp, visible: true }; setLastMove([r,c]);

    // Double Place: 2nd tile every 3rd turn (turns 3, 6, 9, ... for this player)
    if (isPow && power?.id === "doublePlace" && ((playerTurns[cp] || 0) + 1) % 3 === 0 && !pwr.firstDone) {
      const r = scoreAndMark(b, config.playerCount, config.lineLen, scores, teamsArr);
      if (r.pending) {
        setBoard(b);
        setScores(r.scores);
        setPendingLinePick({ pending: r.pending, resume: "doublePlace", extra: {} });
        return;
      }
      const s = r.scores;
      setBoard(b); setScores(s);
      for (let p = 0; p < config.playerCount; p++) {
        if ((s[p] || 0) >= config.linesNeeded) {
          const allScored = [];
          for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++) {
            if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) allScored.push([ri,ci]);
          }
          setWinner(p); setWinCells(allScored);
          setScreen("review"); return;
        }
      }
      setPwr({ ...pwr, firstDone: true }); toast("Place your second tile"); return;
    }

    // Takeover/Block/Teleport: normal tile placed, now prompt for special action
    if (pwr.active && !pwr.firstDone && (power?.id === "takeover" || power?.id === "block" || power?.id === "teleport")) {
      const r = scoreAndMark(b, config.playerCount, config.lineLen, scores, teamsArr);
      if (r.pending) {
        setBoard(b);
        setScores(r.scores);
        setPendingLinePick({ pending: r.pending, resume: "powerFirst", extra: {} });
        return;
      }
      const s = r.scores;
      setBoard(b); setScores(s);
      for (let p = 0; p < config.playerCount; p++) {
        if ((s[p] || 0) >= config.linesNeeded) {
          const allScored = [];
          for (let ri = 0; ri < b.length; ri++) for (let ci = 0; ci < b[ri].length; ci++) {
            if (b[ri][ci]?.owner === p && b[ri][ci]?.scored) allScored.push([ri,ci]);
          }
          setWinner(p); setWinCells(allScored);
          setScreen("review"); return;
        }
      }
      const size = getBlockSize(config.lineLen);
      const prompts = {
        takeover: "Now steal an opponent's tile",
        block: `Now pick top-left of a ${size}×${size} denial area`,
        teleport: "Now pick one of your tiles to move",
      };
      setPwr({ ...pwr, firstDone: true }); toast(prompts[power.id]); return;
    }

    setBoard(b);
    endTurn(b, { ...cooldowns });
  }, [screen, board, blocks, config, cp, onlineSlot, onlinePlayers, cooldowns, pwr, globalTurn, turn, playerTurns, scores, endTurn, toast, pendingLinePick, teamsArr, timerLockout]);

  useEffect(() => { handleClickRef.current = handleClick; }, [handleClick]);

  const pickLineOffset = useCallback((offset) => {
    if (screen === "online-game") {
      onlineConnRef.current?.lineOffset(offset);
      return;
    }
    continueLinePick(offset);
  }, [screen, continueLinePick]);

  const togglePower = useCallback(() => {
    if (screen === "online-game") {
      if (onlineConnRef.current) onlineConnRef.current.powerToggle();
      return;
    }
    if (pwr.active && !pwr.firstDone) { setPwr({ active: false, used: false, firstDone: false, tpSource: null }); return; }
    if (pwr.active && pwr.firstDone) return; // can't cancel after placing normal tile
    // Don't reference `power` here — for teleport, a toast hint is different
    const p = POWERS[config.powers[cp]];
    toast(p.id === "teleport" ? "Place a tile, then pick one to move" : "Place your tile, then use your power");
    setPwr({ ...pwr, active: true, used: true, tpSource: null });
  }, [screen, pwr, config, cp, toast]);

  const themedCss = `:root { ${themeVars(theme)} }\n${css}`;
  if (screen === "setup") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><Setup onStart={startGame} onOnline={() => setScreen("online-lobby")} onStats={() => setScreen("stats")} onSettings={() => setScreen("settings")} onResume={resumeGame} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "stats") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><StatsScreen onBack={() => setScreen("setup")} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "settings") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><SettingsScreen onBack={() => setScreen("setup")} onReplayTutorial={() => { try { localStorage.removeItem("mtt-tutorial-seen"); } catch {} setScreen("setup"); }} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "online-lobby") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><OnlineLobby onBack={() => { if (onlineConn) { onlineConn.close(); setOnlineConn(null); } try { const u = new URL(window.location.href); u.searchParams.delete("room"); window.history.replaceState({}, "", u.toString()); } catch {} setScreen("setup"); }} onGameStart={handleOnlineGameStart} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;

  const isOnline = screen === "online-game" || screen === "online-review";
  const isReview = screen === "review" || screen === "online-review";
  const isPow = config?.mode === "powers";
  const power = isPow ? POWERS[config.powers[cp]] : null;
  const cd = cooldowns[cp] || 0;
  const canUse = isPow && cd === 0 && !pwr.used && power && power.id !== "doublePlace";
  const isDouble = isPow && power?.id === "doublePlace" && ((playerTurns[cp] || 0) + 1) % 3 === 0;
  const playerColor = PLAYERS[cp];
  const winnerColor = winner !== null ? PLAYERS[winner] : null;

  return (
    <ThemeCtx.Provider value={theme}>
      <style>{themedCss}</style>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, height: "100dvh", display: "flex", flexDirection: "column", background: "transparent", userSelect: "none", WebkitUserSelect: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", letterSpacing: "-0.01em", overflow: "hidden", transition: "background 0.3s" }}>
        {isReview && !isDraw && winnerColor && <Confetti color={winnerColor.fill} />}

        {/* Header */}
        <div style={{ background: theme.glassFill, backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)", borderBottom: `0.5px solid ${theme.hair}`, transition: "background 0.3s" }}>
          {isReview ? (
            <div style={{
              padding: "18px 16px", textAlign: "center", animation: "bannerSlide 0.5s cubic-bezier(0.34,1.56,0.64,1)",
              background: theme.glassFillStrong,
              position: "relative", overflow: "hidden",
            }}>
              {!isDraw && (
                <div style={{
                  position: "absolute", top: 0, left: 0, width: "40%", height: "100%",
                  background: `linear-gradient(100deg, transparent 0%, ${theme.inkGhost} 50%, transparent 100%)`,
                  animation: "bannerShine 1.6s ease-out 0.3s",
                  pointerEvents: "none",
                }} />
              )}
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
                {winnerColor && (
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, background: theme.ink,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: `0 2px 12px ${theme.inkGhost}`,
                    animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)",
                  }}>
                    <PlayerMark player={winnerColor} size={20} tone={theme.bg1} bg={theme.ink} />
                  </div>
                )}
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.3px", color: theme.ink }}>
                  {isDraw ? "It's a draw!" : `${winnerColor.name} wins!`}
                </span>
              </div>
              {!isDraw && <p style={{ position: "relative", fontSize: 12, color: theme.inkMuted, marginTop: 8 }}>Completed {config.linesNeeded} line{config.linesNeeded > 1 ? "s" : ""} of {config.lineLen}</p>}
              {isDraw && (
                <div style={{ position: "relative", marginTop: 12, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                  {Array.from({ length: config.playerCount }).map((_, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", borderRadius: 10,
                      background: theme.glassFillSolid, border: `0.5px solid ${theme.hair}`,
                    }}>
                      <PlayerMark player={PLAYERS[i]} size={12} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{PLAYERS[i].name}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: theme.ink, fontVariantNumeric: "tabular-nums" }}>{scores[i] || 0}</span>
                      <span style={{ fontSize: 11, color: theme.inkMuted }}>/ {config.linesNeeded}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 10 }}>
              <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } try { const u = new URL(window.location.href); u.searchParams.delete("room"); window.history.replaceState({}, "", u.toString()); localStorage.removeItem("mtt-last-room"); } catch {} setScreen("setup"); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: "var(--textLabel)" }}>‹</button>
              <div style={{ width: 24, height: 24, borderRadius: 8, background: theme.ink, display: "flex", alignItems: "center", justifyContent: "center", animation: "glassFloat 3s ease-in-out infinite" }}>
                <PlayerMark player={playerColor} size={14} tone={theme.bg1} bg={theme.ink} />
              </div>
              <span key={cp} style={{ fontSize: 15, fontWeight: 600, flex: 1, color: theme.ink, letterSpacing: "-0.02em", animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
                {isOnline ? (() => {
                  const p = onlinePlayers.find(p => p.slot === cp);
                  const nm = p?.name || (cp === onlineSlot ? "You" : "Opponent");
                  return cp === onlineSlot ? "Your turn" : `${nm}'s turn`;
                })() : config.ai && cp === 1 ? "AI thinking..." : `${playerColor.name}'s turn`}
              </span>
              <span style={{ fontSize: 12, color: "var(--textLabel)" }}>Turn {turn}</span>
              {isOnline && spectators.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--textMuted)" }}>{spectators.length} watching</span>
              )}
              {!isOnline && !pwr.firstDone && (
                <div style={{ display: "flex", gap: 6 }}>
                  {history.length > 0 && (
                    <button className="btn-hover" onClick={undo} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", padding: "4px 10px", color: "var(--textMuted)", fontFamily: "inherit" }}>Undo</button>
                  )}
                  {redoHistory.length > 0 && (
                    <button className="btn-hover" onClick={redo} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", padding: "4px 10px", color: "var(--textMuted)", fontFamily: "inherit" }}>Redo</button>
                  )}
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, padding: "0 16px 10px" }}>
            {Array.from({ length: config.playerCount }).map((_, i) => {
              const active = isReview ? i === winner : i === cp;
              return (
              <div key={i} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderRadius: 12, transition: "all 0.2s",
                background: active ? theme.inkGhost : theme.glassFill,
                border: `0.5px solid ${active ? theme.hairStrong : theme.glassBorder}`,
                backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
              }}>
                <PlayerMark player={PLAYERS[i]} size={14} />
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  color: active ? theme.ink : theme.inkMuted,
                  transition: "color 0.3s",
                  display: "inline-flex", alignItems: "center", fontVariantNumeric: "tabular-nums",
                }}>
                  <RollingNumber value={scores[i] || 0} />/{config.linesNeeded}
                  {graceTimers[i] && (
                    <span style={{ fontSize: 10, color: "#F25C54", marginLeft: 4, fontWeight: 700 }}>
                      DC {Math.max(0, Math.ceil((graceTimers[i].until - Date.now()) / 1000))}s
                    </span>
                  )}
                  {forfeitedSlots.includes(i) && (
                    <span style={{ fontSize: 10, color: "#999", marginLeft: 4, fontWeight: 700 }}>FF</span>
                  )}
                </span>
              </div>
              );
            })}
          </div>
        </div>

        {!isReview && pendingLinePick && !(config.ai && pendingLinePick.pending.playerIds.includes(1)) && (
          <div style={{ padding: "10px 16px", background: "var(--surfaceAlt)", borderBottom: "1px solid var(--borderLight)", animation: "slideUp 0.25s ease-out" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
              {(() => {
                const canPick = isOnline
                  ? (onlineSlot >= 0 && canPickLineSlot(pendingLinePick.pending, onlineSlot))
                  : true;
                return canPick
                  ? `More than ${config.lineLen} in a row — pick which ${config.lineLen} tiles count`
                  : "Waiting for opponent to choose which segment scores…";
              })()}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {Array.from({ length: Math.max(0, pendingLinePick.pending.cells.length - config.lineLen + 1) }, (_, i) => {
                const a = i + 1;
                const b = i + config.lineLen;
                const label = a === b ? `${a}` : `${a}–${b}`;
                const canPick = isOnline
                  ? (onlineSlot >= 0 && canPickLineSlot(pendingLinePick.pending, onlineSlot))
                  : true;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!canPick}
                    className="btn-hover"
                    onClick={() => pickLineOffset(i)}
                    style={{
                      padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
                      background: canPick ? "var(--card)" : "var(--surface)",
                      fontSize: 13, fontWeight: 600, cursor: canPick ? "pointer" : "default",
                      fontFamily: "inherit", color: "var(--text)",
                      opacity: canPick ? 1 : 0.55,
                    }}
                  >
                    Tiles {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Player emote feed (floating, top-right) */}
        {isOnline && emoteFeed.some(e => e.slot >= 0) && (
          <div style={{ position: "fixed", top: 70, right: 12, zIndex: 50, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
            {emoteFeed.filter(e => e.slot >= 0).map(e => (
              <div key={e.id} style={{
                background: theme.glassFillStrong, borderRadius: 16, padding: "6px 10px 6px 12px",
                backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
                border: `0.5px solid ${theme.glassBorder}`,
                fontSize: 14, color: theme.ink, boxShadow: theme.glassShadow,
                display: "flex", alignItems: "center", gap: 8,
                animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)",
              }}>
                <PlayerMark player={PLAYERS[e.slot]} size={14} />
                <strong style={{ fontSize: 12, color: theme.ink }}>{e.name}</strong>
                <span>{e.emote}</span>
              </div>
            ))}
          </div>
        )}

        {/* Spectator emote feed (floating, bottom-right) */}
        {isOnline && emoteFeed.some(e => e.slot < 0) && (
          <div style={{ position: "fixed", bottom: 70, right: 12, zIndex: 50, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
            {emoteFeed.filter(e => e.slot < 0).map(e => (
              <div key={e.id} style={{
                background: "rgba(120,120,120,0.15)", borderRadius: 16, padding: "6px 12px",
                fontSize: 13, color: "var(--textMuted)", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                display: "flex", alignItems: "center", gap: 8,
                animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)",
                borderLeft: "3px solid #A0A0A0",
                backdropFilter: "blur(4px)",
              }}>
                <span style={{ fontSize: 11, opacity: 0.7 }}>👀 {e.name}</span>
                <span>{e.emote}</span>
              </div>
            ))}
          </div>
        )}

        {/* Emote bar */}
        {isOnline && !isReview && (
          <div style={{ display: "flex", gap: 6, padding: "6px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", justifyContent: "center" }}>
            {["GG", "😂", "🤔", "👀", "🔥", "😭"].map(e => (
              <button key={e} className="btn-hover" onClick={() => onlineConnRef.current?.emote(e)} style={{
                padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--surface)", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              }}>{e}</button>
            ))}
            {onlineSlot >= 0 && (
              <>
                <div style={{ width: 1, background: "var(--borderLight)", margin: "0 4px" }} />
                <button className="btn-hover" onClick={() => {
                  if (window.confirm("Forfeit this game?")) onlineConnRef.current?.forfeit();
                }} style={{
                  padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface)", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  color: "#F25C54", fontWeight: 600,
                }}>Forfeit</button>
              </>
            )}
          </div>
        )}

        {/* Reconnect banner */}
        {isOnline && connState === "reconnecting" && (
          <ReconnectBanner />
        )}

        {/* Timer bar */}
        {config.timer > 0 && !isReview && (
          <div style={{ padding: "0 16px" }}>
            <div style={{ height: 4, background: theme.hair, borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: timeLeft <= 5 ? "#C8544A" : theme.ink,
                width: `${(timeLeft / config.timer) * 100}%`,
                transition: "width 1s linear",
                animation: timeLeft <= 5 ? "timerShake 0.5s ease-in-out infinite" : undefined,
              }} />
            </div>
            <div style={{ textAlign: "center", fontSize: 11, color: theme.inkMuted, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
              {timeLeft}s
            </div>
          </div>
        )}

        {/* Toast */}
        {msg && (
          <div key={msg} style={{
            position: "fixed", top: 110, left: "50%", transform: "translateX(-50%)",
            background: "var(--toast)", color: "var(--toastText)", padding: "8px 18px", borderRadius: 10,
            fontSize: 13, fontWeight: 500, zIndex: 50,
            animation: "fadeIn 0.25s cubic-bezier(0.16,1,0.3,1)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)", whiteSpace: "nowrap",
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          }}>{msg}</div>
        )}

        {/* Board (with replay override on review) */}
        {(() => {
          const replaying = isReview && replayIdx !== null && history[replayIdx];
          const dBoard = replaying ? history[replayIdx].board : board;
          const dLast = replaying ? history[replayIdx].lastMove : lastMove;
          const dWin = replaying ? [] : winCells;
          const dLinePick = replaying || !pendingLinePick ? null : pendingLinePick.pending?.cells;
          return (
            <Board board={dBoard} onCellClick={handleClick} lastMove={dLast} lastMoves={replaying ? (dLast ? [dLast] : []) : lastMoves} winCells={dWin}
              currentPlayer={cp} actionMode={pwr.active && pwr.firstDone ? power?.id : null} zoom={zoom} onZoom={setZoom} ghostOwner={isOnline ? onlineSlot : cp}
              blocks={replaying ? [] : blocks} globalTurn={globalTurn} tpSource={pwr.tpSource || null} cursor={cursor}
              linePickCells={dLinePick} />
          );
        })()}

        {/* Zoom bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 8px",
          "--zoomTrack": theme.hair,
          "--zoomThumb": theme.ink,
          "--zoomThumbRing": theme.mode === "dark" ? theme.bg1 : "#FBF8F1",
          "--zoomStep": theme.inkMuted,
          "--zoomStepActive": theme.ink,
        }}>
          <button className="zoom-step" onClick={() => { if (zoomTweenRef.current) cancelAnimationFrame(zoomTweenRef.current); tweenZoom(-8); }} disabled={zoom <= 20} aria-label="Zoom out">−</button>
          <input
            type="range"
            className="zoom-slider"
            min={20}
            max={72}
            step={1}
            value={zoom}
            onInput={e => { if (zoomTweenRef.current) cancelAnimationFrame(zoomTweenRef.current); setZoom(+e.target.value); }}
            onChange={e => { if (zoomTweenRef.current) cancelAnimationFrame(zoomTweenRef.current); setZoom(+e.target.value); }}
            aria-label="Zoom"
          />
          <button className="zoom-step" onClick={() => { if (zoomTweenRef.current) cancelAnimationFrame(zoomTweenRef.current); tweenZoom(8); }} disabled={zoom >= 72} aria-label="Zoom in">+</button>
        </div>

        {/* Replay scrubber (review only, needs history) */}
        {isReview && history.length > 0 && (
          <div style={{
            padding: "8px 16px", background: theme.glassFillStrong,
            backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
            borderTop: `0.5px solid ${theme.hair}`, display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 11, color: theme.inkMuted, minWidth: 44, fontVariantNumeric: "tabular-nums" }}>
              {replayIdx === null ? `Final` : `Move ${replayIdx + 1}/${history.length}`}
            </span>
            <input type="range" min={0} max={history.length} step={1}
              value={replayIdx === null ? history.length : replayIdx}
              onChange={e => {
                const v = +e.target.value;
                setReplayIdx(v === history.length ? null : v);
              }}
              style={{ flex: 1, cursor: "pointer", accentColor: theme.ink }} />
            <button className="btn-hover" onClick={() => setReplayIdx(null)} style={{
              padding: "4px 10px", borderRadius: 8, border: `0.5px solid ${theme.hair}`,
              background: theme.glassFillSolid, fontSize: 11, cursor: "pointer", fontFamily: "inherit", color: theme.inkMuted,
            }}>Live</button>
          </div>
        )}

        {/* Bottom bar */}
        {isReview ? (
          <div style={{
            display: "flex", gap: 10, padding: "12px 16px",
            background: theme.glassFillStrong,
            backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
            borderTop: `0.5px solid ${theme.glassBorder}`,
            animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1)",
          }}>
            <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } try { const u = new URL(window.location.href); u.searchParams.delete("room"); window.history.replaceState({}, "", u.toString()); localStorage.removeItem("mtt-last-room"); } catch {} setScreen("setup"); }} style={{
              flex: 1, padding: 12, borderRadius: 12,
              border: `0.5px solid ${theme.hairStrong}`,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: theme.glassFill, color: theme.ink,
              backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
              fontFamily: "inherit",
            }}>{isOnline ? "Leave" : "Setup"}</button>
            <button className="btn-hover" onClick={shareSnapshot} style={{
              padding: "12px 14px", borderRadius: 12,
              border: `0.5px solid ${theme.hairStrong}`,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: theme.glassFill, color: theme.ink,
              backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
              fontFamily: "inherit",
            }} title="Share board image">Share</button>
            <button className="btn-hover" disabled={isOnline && rematchVote.votedSlots.includes(onlineSlot)} onClick={() => isOnline && onlineConnRef.current ? onlineConnRef.current.rematch() : startGame(config)} style={{
              flex: 1, padding: 12, borderRadius: 12,
              border: `0.5px solid ${theme.ink}`,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: theme.ink, color: theme.mode === "dark" ? theme.bg1 : "#FAF7F0",
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
              fontFamily: "inherit", opacity: isOnline && rematchVote.votedSlots.includes(onlineSlot) ? 0.6 : 1,
            }}>{isOnline ? (rematchVote.votedSlots.includes(onlineSlot) ? `Waiting ${rematchVote.count}/${rematchVote.needed}` : (rematchVote.needed > 0 ? `Rematch ${rematchVote.count}/${rematchVote.needed}` : "Rematch")) : "Play Again"}</button>
          </div>
        ) : isPow && (
          <div key={cp} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
            background: theme.glassFillStrong,
            backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
            borderTop: `0.5px solid ${theme.glassBorder}`,
            animation: "slideUp 0.2s cubic-bezier(0.16,1,0.3,1)",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, color: theme.ink }}>
                <span style={{ opacity: 0.55 }}>{power.icon}</span> {power.name}
                {isDouble && <span style={{ fontSize: 11, background: theme.inkGhost, color: theme.ink, padding: "2px 8px", borderRadius: 6, fontWeight: 500, border: `0.5px solid ${theme.hair}`, animation: "popIn 0.2s ease-out" }}>×2 this turn</span>}
                {pwr.firstDone && power.id === "doublePlace" && <span style={{ fontSize: 11, background: "rgba(200,84,74,0.12)", color: "#C8544A", padding: "2px 8px", borderRadius: 6, fontWeight: 500, border: "0.5px solid rgba(200,84,74,0.3)", animation: "popIn 0.2s ease-out" }}>2nd tile</span>}
                {pwr.firstDone && power.id !== "doublePlace" && <span style={{ fontSize: 11, background: theme.inkGhost, color: theme.ink, padding: "2px 8px", borderRadius: 6, fontWeight: 500, border: `0.5px solid ${theme.hair}`, animation: "popIn 0.2s ease-out" }}>use power</span>}
              </div>
              <div style={{ fontSize: 11, color: theme.inkMuted, marginTop: 2, transition: "color 0.2s" }}>
                {cd > 0 ? `Cooldown: ${cd} turn${cd > 1 ? "s" : ""}` : power.desc}
              </div>
            </div>
            {power.id !== "doublePlace" && !pwr.firstDone && (
              <div style={{ position: "relative" }}>
                <button className="btn-hover" onClick={togglePower} disabled={!canUse && !pwr.active} style={{
                  padding: "8px 16px", borderRadius: 10,
                  border: pwr.active ? "0.5px solid rgba(200,84,74,0.4)" : `0.5px solid ${canUse ? theme.hairStrong : theme.hair}`,
                  fontSize: 13, fontWeight: 600,
                  fontFamily: "inherit", cursor: (canUse || pwr.active) ? "pointer" : "default",
                  transition: "all 0.15s",
                  background: pwr.active ? "rgba(200,84,74,0.12)" : canUse ? theme.ink : theme.glassFill,
                  color: pwr.active ? "#C8544A" : canUse ? (theme.mode === "dark" ? theme.bg1 : "#FAF7F0") : theme.inkFaint,
                  backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                }}>{pwr.active ? "Cancel" : "Use"}</button>
                {cd > 0 && !pwr.active && (
                  <div style={{
                    position: "absolute", top: -6, right: -6,
                    minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                    background: "#C8544A", color: "#fff", fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)", pointerEvents: "none",
                  }}>{cd}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}
