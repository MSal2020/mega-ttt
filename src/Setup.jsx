import { useState, useEffect } from "react";
import { PLAYERS, POWERS, getWinConditions } from "../lib/gameLogic.js";
import { useTheme } from "./theme.js";
import { PlayerMark, Collapse } from "./widgets.jsx";
import { Tutorial, HeroShapeGrid } from "./screens.jsx";

export function Setup({ onStart, onOnline, onStats, onSettings, onResume, dark, setDark }) {
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
  const [showTutorial, setShowTutorial] = useState(() => { try { return !localStorage.getItem("mtt-tutorial-seen"); } catch { return true; } });
  const closeTutorial = () => { try { localStorage.setItem("mtt-tutorial-seen", "1"); } catch {} setShowTutorial(false); };
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", overflow: "visible" }}>
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
            <div style={{ display: "flex", justifyContent: "flex-start" }} />
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
