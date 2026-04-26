import { useState, useEffect, useMemo, useRef } from "react";
import { PLAYERS } from "../lib/gameLogic.js";
import { useTheme } from "./theme.js";
import { PlayerMark } from "./widgets.jsx";
import {
  sfx, haptic, soundEnabled, setSoundEnabled,
  hapticEnabled, setHapticEnabled, reducedMotion, setReducedMotion,
} from "./sounds.js";
import { getStats, clearStats, getTotalGames, getTotalWins, getWinRate } from "./stats.js";
import { LocalIcon, AIIcon, OnlineIcon } from "./Icons.jsx";

export function StatsScreen({ onBack }) {
  const t = useTheme();
  const [stats, setStats] = useState(getStats);
  const total = getTotalGames(stats);
  const wins = getTotalWins(stats);
  const rate = getWinRate(stats);

  const modes = [
    { key: "local", label: "Local", icon: LocalIcon },
    { key: "ai", label: "vs AI", icon: AIIcon },
    { key: "online", label: "Online", icon: OnlineIcon },
  ];

  const resultTone = { win: t.ink, loss: t.inkMuted, draw: t.inkFaint };
  const resultLabels = { win: "Won", loss: "Lost", draw: "Draw" };

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none" }}>
        <div className="glass-card-glow" style={{
          background: t.glassFill, backdropFilter: "blur(22px) saturate(180%)", WebkitBackdropFilter: "blur(22px) saturate(180%)",
          border: `0.5px solid ${t.glassBorder}`, boxShadow: t.glassShadow,
          borderRadius: 22, padding: "32px 28px", width: "100%", maxWidth: 420,
          animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-hover" onClick={onBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.ink, flex: 1 }}>Stats</h1>
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
                  <m.icon color={t.inkMuted} size={16} />
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

export function SettingsScreen({ onBack, onReplayTutorial, dark, setDark }) {
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
        <div className="glass-card-glow" style={{
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

export function Tutorial({ onClose }) {
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
export function HeroShapeGrid({ gridSize = 12, playerCount = 2, mode = "normal", staticBackdrop = false }) {
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
      const dir = Math.floor(Math.random() * 4);
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

export function LobbyPresence({ roomCode, players, you, playerCount, gridSize, mode }) {
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
