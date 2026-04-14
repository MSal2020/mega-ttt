import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import {
  PLAYERS, POWERS, getWinConditions, makeBoard, cloneBoard,
  findLines, revealGhosts, scoreAndMark, aiPickMove,
  isBoardFull, getScoredCells, generateRoomCode,
} from "../lib/gameLogic.js";
import { createConnection } from "./multiplayer.js";
import { getStats, recordGame, clearStats, getTotalGames, getTotalWins, getWinRate } from "./stats.js";

const THEMES = {
  light: {
    bg: "#F7F6F3", card: "#fff", cardShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)",
    text: "#1a1a1a", textMuted: "#888", textFaint: "#bbb", textLabel: "#999",
    border: "#E5E4E0", borderLight: "#F0EFEC",
    surface: "#FAFAF8", surfaceAlt: "#F0EFEC",
    cell: "#fff", cellWall: "#EEEDEA", grid: "#E5E4E0",
    btnPrimary: "#1a1a1a", btnPrimaryText: "#fff",
    toast: "rgba(26,26,26,0.9)", toastText: "#fff",
  },
  dark: {
    bg: "#1a1a1a", card: "#252525", cardShadow: "0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)",
    text: "#f0f0f0", textMuted: "#888", textFaint: "#555", textLabel: "#777",
    border: "#383838", borderLight: "#303030",
    surface: "#2a2a2a", surfaceAlt: "#333",
    cell: "#2e2e2e", cellWall: "#252525", grid: "#383838",
    btnPrimary: "#f0f0f0", btnPrimaryText: "#1a1a1a",
    toast: "rgba(240,240,240,0.9)", toastText: "#1a1a1a",
  },
};

const ThemeCtx = createContext(THEMES.light);
function useTheme() { return useContext(ThemeCtx); }

function themeVars(t) {
  return Object.entries(t).map(([k,v]) => `--${k}: ${v};`).join(" ");
}

const css = `
  @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; transform: translateX(-50%) translateY(0); } to { opacity: 0; transform: translateX(-50%) translateY(-8px); } }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(74,123,247,0.3); } 50% { box-shadow: 0 0 0 6px rgba(74,123,247,0); } }
  @keyframes scoreGlow { 0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; } 40% { box-shadow: 0 0 8px 4px currentColor; opacity: 0.8; } 100% { box-shadow: none; opacity: 0.35; } }
  @keyframes wallDrop { 0% { transform: scale(0) rotate(-45deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 0.35; } }
  @keyframes ghostFade { 0% { opacity: 0; transform: scale(1.3); } 100% { opacity: 0.5; transform: scale(1); } }
  @keyframes stealFlash { 0% { background: rgba(242,92,84,0.3); } 100% { background: transparent; } }
  @keyframes revealPop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
  @keyframes winPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
  @keyframes timerShrink { from { width: 100%; } to { width: 0%; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scoreBump { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
  @keyframes boardIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes bannerIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes miniIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
  * { box-sizing: border-box; margin: 0; touch-action: manipulation; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; overscroll-behavior: none; background: var(--bg); color: var(--text); transition: background 0.3s, color 0.3s; }
  input[type=range] { accent-color: #4A7BF7; }
  .cell:hover .cell-hover { background: rgba(74,123,247,0.06); }
  .btn-hover { transition: transform 0.12s, box-shadow 0.12s, opacity 0.12s; }
  .btn-hover:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .btn-hover:active { transform: translateY(0) scale(0.97); box-shadow: none; }
  select { color-scheme: light dark; }
`;

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

  const resultColors = { win: "#4DAA6D", loss: "#F25C54", draw: "#F2A93B" };
  const resultLabels = { win: "Won", loss: "Lost", draw: "Draw" };

  return (
    <div style={{ minHeight: "100dvh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none", transition: "background 0.3s" }}>
      <div style={{ background: t.card, borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 420, boxShadow: t.cardShadow, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", transition: "background 0.3s, box-shadow 0.3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btn-hover" onClick={onBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.textLabel }}>←</button>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.text, flex: 1 }}>Stats</h1>
          <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, opacity: 0.6 }}>{dark ? "☀" : "☾"}</button>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          {[
            { label: "Games", value: total },
            { label: "Wins", value: wins },
            { label: "Win Rate", value: `${rate}%` },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: t.surface, borderRadius: 10, padding: "14px 10px", textAlign: "center", transition: "background 0.3s" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: t.text }}>{s.value}</div>
              <div style={{ fontSize: 11, color: t.textLabel, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Per-mode breakdown */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>By Mode</div>
          {modes.map(m => {
            const s = stats[m.key] || { wins: 0, losses: 0, draws: 0, games: 0 };
            return (
              <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: t.surface, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: t.text }}>{m.label}</span>
                <span style={{ fontSize: 12, color: "#4DAA6D", fontWeight: 600 }}>{s.wins}W</span>
                <span style={{ fontSize: 12, color: "#F25C54", fontWeight: 600 }}>{s.losses}L</span>
                <span style={{ fontSize: 12, color: "#F2A93B", fontWeight: 600 }}>{s.draws}D</span>
              </div>
            );
          })}
        </div>

        {/* Recent games */}
        {stats.history?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Recent Games</div>
            <div style={{ maxHeight: 200, overflow: "auto" }}>
              {stats.history.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: i % 2 === 0 ? t.surface : "transparent", fontSize: 13 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: resultColors[g.result], flexShrink: 0 }} />
                  <span style={{ color: resultColors[g.result], fontWeight: 600, width: 36 }}>{resultLabels[g.result]}</span>
                  <span style={{ color: t.textMuted, flex: 1 }}>{g.mode === "ai" ? "vs AI" : g.mode} · {g.gridSize}x{g.gridSize}</span>
                  <span style={{ color: t.textFaint, fontSize: 11 }}>{new Date(g.date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {total > 0 && (
          <button className="btn-hover" onClick={() => { if (confirm("Clear all stats?")) setStats(clearStats()); }} style={{
            width: "100%", padding: 10, borderRadius: 10, border: `1.5px solid ${t.border}`,
            background: "transparent", fontSize: 13, color: t.textLabel, cursor: "pointer",
            fontFamily: "inherit", marginTop: 20,
          }}>Clear Stats</button>
        )}
      </div>
    </div>
  );
}

function OnlineLobby({ onBack, onGameStart, dark, setDark }) {
  const t = useTheme();
  const [tab, setTab] = useState("menu"); // menu | create | join
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [conn, setConn] = useState(null);
  const [players, setPlayers] = useState([]);
  const [you, setYou] = useState(-1);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [copied, setCopied] = useState(false);

  // Config state (host only)
  const [mode, setMode] = useState("normal");
  const [gridSize, setGridSize] = useState(12);
  const autoWc = getWinConditions(gridSize, 2);
  const wc = autoWc;

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
            const existing = prev.find(p => p.slot === msg.slot);
            if (existing) return prev;
            return [...prev, { slot: msg.slot, name: msg.name }];
          });
          break;
        case "player-left":
          setPlayers(prev => prev.filter(p => p.slot !== msg.slot));
          break;
        case "config-updated":
          break;
        case "game-started":
        case "move-applied":
        case "game-over":
          onGameStart(connection, msg);
          break;
        case "error":
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
          break;
        default: break;
      }
    });

    connection.ws.addEventListener("open", () => {
      connection.join(isHost ? "Host" : "Guest");
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
  }, [onGameStart]);

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
    const config = {
      mode, gridSize, playerCount: 2,
      powers: [0, 1],
      ...wc,
      timer: 0,
      ai: false,
    };
    conn.setConfig(config);
    setTimeout(() => conn.start(), 100);
  }, [conn, mode, gridSize, wc]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomCode]);

  // Note: no cleanup-on-unmount here — when the game starts, the lobby
  // unmounts but the parent takes ownership of the connection via onGameStart.
  // Explicit "Back" button handles closing.

  const isHost = you === 0;
  const opponentJoined = players.length >= 2;

  return (
    <div style={{ minHeight: "100dvh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none", transition: "background 0.3s" }}>
      <div style={{ background: t.card, borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 420, boxShadow: t.cardShadow, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", transition: "background 0.3s, box-shadow 0.3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btn-hover" onClick={onBack} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.textLabel }}>←</button>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.text, flex: 1 }}>Play Online</h1>
          <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, opacity: 0.6 }}>{dark ? "☀" : "☾"}</button>
        </div>

        {error && (
          <div style={{ marginTop: 16, padding: "8px 14px", borderRadius: 8, background: "#FDE8E7", color: "#F25C54", fontSize: 13, fontWeight: 500, textAlign: "center", animation: "slideUp 0.2s ease-out" }}>
            {error}
          </div>
        )}

        {tab === "menu" && (
          <div style={{ marginTop: 32 }}>
            <button className="btn-hover" onClick={createRoom} style={{
              width: "100%", padding: 16, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
              cursor: "pointer", background: t.btnPrimary, color: t.btnPrimaryText,
              fontFamily: "inherit", marginBottom: 12,
            }}>Create Room</button>
            <div style={{ fontSize: 12, color: t.textLabel, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.5px", margin: "16px 0" }}>or join a friend</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="ABCD"
                maxLength={4}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                style={{
                  flex: 1, padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${t.border}`,
                  fontSize: 18, fontWeight: 700, textAlign: "center", letterSpacing: 6,
                  fontFamily: "inherit", background: t.surface, color: t.text, outline: "none",
                }}
              />
              <button className="btn-hover" onClick={joinRoom} style={{
                padding: "12px 20px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600,
                cursor: "pointer", background: "#4A7BF7", color: "#fff", fontFamily: "inherit",
              }}>Join</button>
            </div>
          </div>
        )}

        {(tab === "create" || tab === "join") && (
          <div style={{ marginTop: 24 }}>
            {/* Room code display */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Room Code</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: "#4A7BF7" }}>{roomCode}</span>
                <button className="btn-hover" onClick={copyCode} style={{
                  background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8,
                  padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.textMuted, fontFamily: "inherit",
                }}>{copied ? "Copied!" : "Copy"}</button>
              </div>
            </div>

            {/* Players */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Players</div>
              {[0, 1].map(slot => {
                const p = players.find(p => p.slot === slot);
                return (
                  <div key={slot} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderRadius: 10, background: t.surface, marginBottom: 4,
                    transition: "background 0.2s",
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: p ? PLAYERS[slot].fill : t.border,
                      transition: "background 0.3s",
                    }} />
                    <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: p ? t.text : t.textFaint }}>
                      {p ? `${p.name}${slot === you ? " (you)" : ""}` : "Waiting..."}
                    </span>
                    {p && slot === 0 && <span style={{ fontSize: 11, color: "#4A7BF7", fontWeight: 600 }}>HOST</span>}
                    {!p && (
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.textFaint, animation: "pulse 1.5s infinite" }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Host: game config + start button */}
            {isHost && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
                  <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 10, padding: 3, gap: 2 }}>
                    {["normal", "powers"].map(m => (
                      <button key={m} onClick={() => setMode(m)} style={{
                        flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500,
                        cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                        background: mode === m ? t.card : "transparent", color: mode === m ? t.text : t.textMuted,
                        boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                      }}>{m === "normal" ? "Normal" : "Powers"}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#4A7BF7" }}>{gridSize}x{gridSize}</span>
                  </div>
                  <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
                </div>
                <button className="btn-hover" onClick={startGame} disabled={!opponentJoined} style={{
                  width: "100%", padding: 14, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
                  cursor: opponentJoined ? "pointer" : "default", background: t.btnPrimary, color: t.btnPrimaryText,
                  fontFamily: "inherit", opacity: opponentJoined ? 1 : 0.4,
                  transition: "opacity 0.15s",
                }}>
                  {opponentJoined ? "Start Game" : "Waiting for opponent..."}
                </button>
              </>
            )}

            {/* Guest: waiting for host to start */}
            {!isHost && status === "connected" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 14, color: t.textMuted }}>
                  {opponentJoined ? "Waiting for host to start..." : "Connecting..."}
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%", background: "#4A7BF7",
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
  );
}

function Setup({ onStart, onOnline, onStats, dark, setDark }) {
  const t = useTheme();
  const [mode, setMode] = useState("normal");
  const [gridSize, setGridSize] = useState(12);
  const [playerCount, setPlayerCount] = useState(2);
  const [powers, setPowers] = useState([0, 1, 2, 3]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLineLen, setCustomLineLen] = useState(null);
  const [customLinesNeeded, setCustomLinesNeeded] = useState(null);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(15);
  const [vsAI, setVsAI] = useState(false);
  const autoWc = getWinConditions(gridSize, playerCount);
  const wc = {
    lineLen: customLineLen ?? autoWc.lineLen,
    linesNeeded: customLinesNeeded ?? autoWc.linesNeeded,
  };
  const usedPowers = powers.slice(0, playerCount);
  const hasDupes = mode === "powers" && new Set(usedPowers).size < usedPowers.length;

  return (
    <div style={{ minHeight: "100dvh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none", transition: "background 0.3s" }}>
      <div style={{ background: t.card, borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 420, boxShadow: t.cardShadow, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", transition: "background 0.3s, box-shadow 0.3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div />
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center", color: t.text }}>Mega Tic Tac Toe</h1>
          <button onClick={() => setDark(d => !d)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, opacity: 0.6 }}>{dark ? "☀" : "☾"}</button>
        </div>
        <p style={{ fontSize: 14, color: t.textMuted, textAlign: "center", marginTop: 6 }}>Customise your game</p>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
          <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 10, padding: 3, gap: 2, transition: "background 0.3s" }}>
            {["normal", "powers"].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500,
                cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                background: mode === m ? t.card : "transparent", color: mode === m ? t.text : t.textMuted,
                boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>{m === "normal" ? "Normal" : "Powers"}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
            <span key={gridSize} style={{ fontSize: 20, fontWeight: 700, color: "#4A7BF7", animation: "scoreBump 0.2s ease-out" }}>{gridSize}×{gridSize}</span>
          </div>
          <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textFaint, marginTop: 2 }}>
            <span>7×7</span><span>20×20</span>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setPlayerCount(n)} style={{
                width: 48, height: 48, borderRadius: 10, fontSize: 18, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
                border: playerCount === n ? "2px solid #4A7BF7" : `1.5px solid ${t.border}`,
                background: playerCount === n ? "#E8EFFE" : t.card,
                color: playerCount === n ? "#4A7BF7" : t.textMuted,
              }}>{n}</button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{
                  width: 14, height: 14, borderRadius: "50%", background: PLAYERS[i].fill,
                  transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s",
                  transform: i < playerCount ? "scale(1)" : "scale(0)",
                  opacity: i < playerCount ? 1 : 0,
                }} />
              ))}
            </div>
          </div>
        </div>

        {playerCount === 2 && (
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Opponent</div>
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{vsAI ? "Play vs AI" : "Local multiplayer"}</div>
            </div>
            <button onClick={() => setVsAI(v => !v)} style={{
              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
              background: vsAI ? "#4A7BF7" : t.border, position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", background: t.card, position: "absolute", top: 2,
                left: vsAI ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }} />
            </button>
          </div>
        )}

        <Collapse open={mode === "powers"} maxH={300}>
          <div style={{ marginTop: 22, paddingBottom: 2 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Assign powers</div>
            {Array.from({ length: playerCount }).map((_, pi) => (
              <div key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: t.surface, borderRadius: 10, padding: "8px 12px", marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: PLAYERS[pi].fill, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, width: 48, flexShrink: 0, color: t.text }}>{PLAYERS[pi].name}</span>
                <select value={powers[pi]} onChange={e => { const p = [...powers]; p[pi] = +e.target.value; setPowers(p); }}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: `1.5px solid ${t.border}`, fontSize: 13, fontFamily: "inherit", background: t.card, color: t.text }}>
                  {POWERS.map((pw, wi) => <option key={wi} value={wi}>{pw.icon} {pw.name}</option>)}
                </select>
              </div>
            ))}
            {hasDupes && <p style={{ fontSize: 12, color: "#F25C54", marginTop: 4 }}>Each player should have a unique power</p>}
          </div>
        </Collapse>

        <div style={{ marginTop: 22, background: t.surface, borderRadius: 10, padding: "12px 14px", transition: "background 0.3s" }}>
          <div style={{ fontSize: 12, color: t.textLabel, fontWeight: 500, marginBottom: 4 }}>Win condition</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
            {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
            {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: "#4A7BF7", marginLeft: 6 }}>custom</span>}
          </div>
        </div>

        <button onClick={() => setShowAdvanced(v => !v)} style={{
          width: "100%", padding: "10px 0", border: "none", background: "none",
          fontSize: 13, color: t.textLabel, cursor: "pointer", fontFamily: "inherit",
          marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
          Advanced settings
        </button>

        <Collapse open={showAdvanced} maxH={400}>
          <div style={{ background: t.surface, borderRadius: 10, padding: "14px", marginTop: 4, transition: "background 0.3s" }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: customLineLen !== null ? "#4A7BF7" : t.text, transition: "color 0.2s" }}>{wc.lineLen}</span>
              </div>
              <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textFaint, marginTop: 2 }}>
                <span>3</span><span>{Math.min(gridSize, 8)}</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: customLinesNeeded !== null ? "#4A7BF7" : t.text, transition: "color 0.2s" }}>{wc.linesNeeded}</span>
              </div>
              <input type="range" min={1} max={5} value={wc.linesNeeded}
                onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textFaint, marginTop: 2 }}>
                <span>1</span><span>5</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Turn timer</div>
                <button onClick={() => setTimerEnabled(v => !v)} style={{
                  width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                  background: timerEnabled ? "#4A7BF7" : t.border, position: "relative", transition: "background 0.2s",
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", background: t.card, position: "absolute", top: 2,
                    left: timerEnabled ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }} />
                </button>
              </div>
              <Collapse open={timerEnabled} maxH={120}>
                <div style={{ paddingBottom: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: t.textMuted }}>Seconds per turn</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#4A7BF7" }}>{timerSeconds}s</span>
                  </div>
                  <input type="range" min={5} max={60} step={5} value={timerSeconds}
                    onChange={e => setTimerSeconds(+e.target.value)}
                    style={{ width: "100%", cursor: "pointer" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textFaint, marginTop: 2 }}>
                    <span>5s</span><span>60s</span>
                  </div>
                </div>
              </Collapse>
            </div>
            {(customLineLen !== null || customLinesNeeded !== null) && (
              <button className="btn-hover" onClick={() => { setCustomLineLen(null); setCustomLinesNeeded(null); }} style={{
                width: "100%", padding: 8, borderRadius: 8, border: `1.5px solid ${t.border}`,
                background: t.card, fontSize: 12, color: t.textLabel, cursor: "pointer",
                fontFamily: "inherit", marginTop: 10,
              }}>Reset to default</button>
            )}
          </div>
        </Collapse>

        <button className="btn-hover" onClick={() => !hasDupes && onStart({ mode, gridSize, playerCount, powers: powers.slice(0, playerCount), ...wc, timer: timerEnabled ? timerSeconds : 0, ai: vsAI && playerCount === 2 })}
          style={{
            width: "100%", padding: 14, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
            cursor: hasDupes ? "default" : "pointer", background: t.btnPrimary, color: t.btnPrimaryText,
            fontFamily: "inherit", marginTop: 24, opacity: hasDupes ? 0.4 : 1,
            transition: "opacity 0.15s, transform 0.12s, box-shadow 0.12s",
          }}>Start Game</button>
        <button className="btn-hover" onClick={onOnline}
          style={{
            width: "100%", padding: 14, borderRadius: 12, border: `1.5px solid #4A7BF7`, fontSize: 15, fontWeight: 600,
            cursor: "pointer", background: "transparent", color: "#4A7BF7",
            fontFamily: "inherit", marginTop: 10,
            transition: "transform 0.12s, box-shadow 0.12s",
          }}>Play Online</button>
        <button className="btn-hover" onClick={onStats}
          style={{
            width: "100%", padding: 10, borderRadius: 12, border: "none", fontSize: 13,
            cursor: "pointer", background: "transparent", color: t.textLabel,
            fontFamily: "inherit", marginTop: 6,
          }}>View Stats</button>
      </div>
    </div>
  );
}

function Board({ board, onCellClick, lastMove, winCells, currentPlayer, actionMode, zoom, onZoom, ghostOwner }) {
  const t = useTheme();
  const n = board.length;
  const cellSize = Math.max(28, Math.round(zoom));
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
        pinchRef.current = { dist: Math.hypot(dx, dy), zoom };
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
        onZoom(newZoom);
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

  // Minimap
  const miniRef = useRef(null);
  const [miniState, setMiniState] = useState({ show: false, sl: 0, st: 0, sw: 0, sh: 0, cw: 0, ch: 0 });
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

  return (
    <div ref={containerRef} style={{
      flex: 1, overflow: "auto", WebkitOverflowScrolling: "touch",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "8px 12px 12px", minHeight: 0, background: "var(--bg)", position: "relative",
    }}>
      {miniState.show && (
        <canvas ref={miniRef} onClick={onMiniClick} style={{
          position: "fixed", bottom: 70, right: 12, width: 90, height: 90,
          borderRadius: 8, border: `1.5px solid ${t.border}`, background: t.card,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)", cursor: "pointer", zIndex: 40,
          animation: "miniIn 0.3s cubic-bezier(0.16,1,0.3,1)",
        }} />
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${n}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${n}, ${cellSize}px)`,
        gap, background: "var(--grid)", borderRadius: 6, padding: gap, flexShrink: 0,
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

          const clickable = (!cell && !actionMode) || stealTarget || (actionMode === "block" && !cell) || (actionMode === "ghost" && !cell);

          return (
            <div key={`${r}-${c}`} className={clickable ? "cell" : undefined} onClick={() => onCellClick(r, c)} style={{
              width: cellSize, height: cellSize, background: isWall ? "var(--cellWall)" : "var(--cell)",
              borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: clickable ? "pointer" : "default",
              position: "relative", transition: "background 0.2s",
            }}>
              {clickable && !cell && (
                <div className="cell-hover" style={{
                  position: "absolute", inset: 0, borderRadius: 3, transition: "background 0.15s",
                }} />
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
                  width: cellSize * 0.6, height: cellSize * 0.6, borderRadius: "50%",
                  background: color.fill,
                  color: color.fill,
                  opacity: isScored ? 0.35 : 1,
                  animation: won ? `winPulse 0.6s ease-in-out infinite`
                    : cell.anim === "score" ? `scoreGlow 0.6s ease-out forwards`
                    : cell.anim === "steal" ? `popIn 0.3s cubic-bezier(0.34,1.56,0.64,1), stealFlash 0.4s ease-out`
                    : cell.anim === "reveal" ? `revealPop 0.4s cubic-bezier(0.34,1.56,0.64,1)`
                    : last ? "popIn 0.25s cubic-bezier(0.34,1.56,0.64,1)" : undefined,
                  boxShadow: won ? `0 0 0 3px ${color.ring}` : undefined,
                  transition: "box-shadow 0.3s",
                }} />
              )}
              {showGhost && (
                <div style={{
                  width: cellSize * 0.55, height: cellSize * 0.55, borderRadius: "50%",
                  border: `2px dashed ${PLAYERS[cell.owner].ring}`, opacity: 0.5,
                  animation: cell.anim === "ghost" ? "ghostFade 0.3s ease-out" : undefined,
                }} />
              )}
              {isGhost && !showGhost && (
                <div style={{ width: cellSize * 0.25, height: cellSize * 0.25, borderRadius: "50%", background: t.textFaint }} />
              )}
              {stealTarget && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: 3,
                  border: "2px solid #F25C54", background: "rgba(242,92,84,0.06)",
                  animation: "slideUp 0.2s ease-out",
                }} />
              )}
            </div>
          );
        }))}
      </div>
    </div>
  );
}


export default function MegaTicTacToe() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = THEMES[dark ? "dark" : "light"];
  const [screen, setScreen] = useState("setup"); // setup | game | review | online-lobby | online-game | online-review
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
  const [pwr, setPwr] = useState({ active: false, used: false, firstDone: false });
  const [zoom, setZoom] = useState(44);
  const [msg, setMsg] = useState(null);
  const [history, setHistory] = useState([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  // Online multiplayer state
  const [onlineConn, setOnlineConn] = useState(null);
  const [onlineSlot, setOnlineSlot] = useState(-1);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const onlineConnRef = useRef(null);

  const toast = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(null), 1600); }, []);

  const startGame = useCallback((cfg) => {
    setConfig(cfg);
    setBoard(makeBoard(cfg.gridSize));
    setCp(0); setTurn(1); setGlobalTurn(1);
    setScores({}); setCooldowns({}); setPlayerTurns({}); setLastMove(null);
    setWinCells([]); setWinner(null); setIsDraw(false);
    setPwr({ active: false, used: false, firstDone: false });
    setMsg(null); setHistory([]);
    setTimeLeft(cfg.timer || 0);
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
    if (msg.pwr) setPwr(msg.pwr);
    if (msg.timeLeft !== undefined) setTimeLeft(msg.timeLeft);
    if (msg.you !== undefined) setOnlineSlot(msg.you);
    if (msg.players) setOnlinePlayers(msg.players);

    if (msg.config?.gridSize) {
      const vw = Math.min(window.innerWidth - 32, 600);
      setZoom(Math.min(52, Math.max(22, Math.floor(vw / msg.config.gridSize))));
    }

    if (msg.phase === "playing") setScreen("online-game");
    else if (msg.phase === "review") setScreen("online-review");
    else if (msg.phase === "lobby") setScreen("online-lobby");
  }, []);

  const handleOnlineGameStart = useCallback((connection, msg) => {
    onlineConnRef.current = connection;
    setOnlineConn(connection);
    setHistory([]);
    setMsg(null);
    applyOnlineState(msg);
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
      if (msg.type === "player-joined") {
        setOnlinePlayers(prev => {
          if (prev.find(p => p.slot === msg.slot)) return prev;
          return [...prev, { slot: msg.slot, name: msg.name }];
        });
        toast(`${msg.name} joined`);
        return;
      }
      if (msg.type === "player-left") {
        setOnlinePlayers(prev => prev.filter(p => p.slot !== msg.slot));
        toast("Opponent left");
        return;
      }
      if (msg.type === "error") {
        toast(msg.message);
        return;
      }
      // Full state updates
      if (msg.board || msg.phase) {
        applyOnlineState(msg);
      }
    };

    // Re-add the handler (replaces the lobby handler)
    const wsHandler = (e) => {
      try { handler(JSON.parse(e.data)); } catch {}
    };
    onlineConn.ws.addEventListener("message", wsHandler);
    return () => onlineConn.ws.removeEventListener("message", wsHandler);
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

  const endTurn = useCallback((newBoard, newCd) => {
    const s = scoreAndMark(newBoard, config.playerCount, config.lineLen, scores);
    for (let p = 0; p < config.playerCount; p++) {
      if ((s[p] || 0) >= config.linesNeeded) {
        const allScored = [];
        for (let r = 0; r < newBoard.length; r++) for (let c = 0; c < newBoard[r].length; c++) {
          if (newBoard[r][c]?.owner === p && newBoard[r][c]?.scored) allScored.push([r,c]);
        }
        setBoard(newBoard); setScores(s); setWinner(p);
        setWinCells(allScored);
        setScreen("review"); return;
      }
    }
    let full = true;
    outer: for (let r = 0; r < newBoard.length; r++) for (let c = 0; c < newBoard[0].length; c++) if (!newBoard[r][c]) { full = false; break outer; }
    if (full) { setBoard(newBoard); setScores(s); setIsDraw(true); setScreen("review"); return; }

    const next = (cp + 1) % config.playerCount;
    const nextGT = globalTurn + 1;
    const nextRound = next === 0 ? turn + 1 : turn;
    const cd = { ...newCd }; if (cd[next] > 0) cd[next]--;
    const revealed = revealGhosts(newBoard, nextRound);
    const s2 = scoreAndMark(revealed, config.playerCount, config.lineLen, s);
    for (let p = 0; p < config.playerCount; p++) {
      if ((s2[p] || 0) >= config.linesNeeded) {
        const allScored = [];
        for (let r = 0; r < revealed.length; r++) for (let c = 0; c < revealed[r].length; c++) {
          if (revealed[r][c]?.owner === p && revealed[r][c]?.scored) allScored.push([r,c]);
        }
        setBoard(revealed); setScores(s2); setWinner(p);
        setWinCells(allScored);
        setScreen("review"); return;
      }
    }
    setBoard(revealed); setScores(s2); setCooldowns(cd);
    setPlayerTurns(pt => ({ ...pt, [cp]: (pt[cp] || 0) + 1 }));
    setCp(next); setGlobalTurn(nextGT);
    if (next === 0) setTurn(t => t + 1);
    setPwr({ active: false, used: false, firstDone: false });
    if (config.timer) setTimeLeft(config.timer);
  }, [config, cp, globalTurn, turn, scores]);

  // Turn timer countdown — only depends on screen/cp/config to avoid restarts
  const boardRef = useRef(board);
  const cooldownsRef = useRef(cooldowns);
  const endTurnRef = useRef(endTurn);
  boardRef.current = board;
  cooldownsRef.current = cooldowns;
  endTurnRef.current = endTurn;

  useEffect(() => {
    if (!config?.timer || screen !== "game") return;
    const id = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(id);
          setTimeout(() => {
            const b = boardRef.current;
            const empty = [];
            for (let r = 0; r < b.length; r++) for (let c = 0; c < b[0].length; c++) if (!b[r][c]) empty.push([r,c]);
            if (empty.length > 0) {
              const [r, c] = empty[Math.floor(Math.random() * empty.length)];
              setPwr({ active: false, used: false, firstDone: false });
              const nb = b.map(row => row.map(x => x ? {...x} : null));
              nb[r][c] = { owner: cp, visible: true }; setLastMove([r,c]);
              setBoard(nb);
              endTurnRef.current(nb, { ...cooldownsRef.current });
              toast("Time's up! Random tile placed");
            }
          }, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [screen, cp, config, toast]);

  // AI auto-play
  useEffect(() => {
    if (screen !== "game" || !config?.ai || cp !== 1) return;
    const delay = 400 + Math.random() * 300; // slight human-like delay
    const id = setTimeout(() => {
      const move = aiPickMove(boardRef.current, 1, config.lineLen, config.playerCount);
      if (move) {
        const [r, c] = move;
        const b = boardRef.current.map(row => row.map(x => x ? {...x} : null));
        b[r][c] = { owner: 1, visible: true };
        setLastMove([r, c]);
        setHistory(h => [...h, {
          board: boardRef.current.map(row => row.map(x => x ? { ...x } : null)),
          cp: 1, turn, globalTurn, scores: { ...scores }, cooldowns: { ...cooldownsRef.current },
          playerTurns: { ...playerTurns }, lastMove, undoPlayer: 1,
        }]);
        setBoard(b);
        endTurnRef.current(b, { ...cooldownsRef.current });
      }
    }, delay);
    return () => clearTimeout(id);
  }, [screen, cp, config, turn, globalTurn, scores, playerTurns, lastMove]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const snap = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setBoard(snap.board); setCp(snap.cp); setTurn(snap.turn);
    setGlobalTurn(snap.globalTurn); setScores(snap.scores);
    setCooldowns(snap.cooldowns); setPlayerTurns(snap.playerTurns);
    setLastMove(snap.lastMove); setWinCells([]); setWinner(null);
    setIsDraw(false); setPwr({ active: false, used: false, firstDone: false });
    setScreen("game"); setMsg(null);
    toast(`Undid ${PLAYERS[snap.undoPlayer].name}'s move`);
  }, [history, toast]);

  const handleClick = useCallback((r, c) => {
    // Online mode: send move to server
    if (screen === "online-game") {
      if (onlinePlayers.length < 2) { toast("Waiting for opponent"); return; }
      if (cp !== onlineSlot) { toast("Opponent's turn"); return; }
      if (onlineConnRef.current) onlineConnRef.current.move(r, c);
      return;
    }
    if (screen !== "game") return;
    if (config.ai && cp === 1) return; // AI's turn, ignore clicks
    const cell = board[r][c];
    const isPow = config.mode === "powers";
    const power = isPow ? POWERS[config.powers[cp]] : null;

    // Save snapshot on first action of a turn (not step 2)
    if (!pwr.firstDone) {
      setHistory(h => [...h, {
        board: board.map(row => row.map(x => x ? { ...x } : null)),
        cp, turn, globalTurn, scores: { ...scores }, cooldowns: { ...cooldowns },
        playerTurns: { ...playerTurns }, lastMove, undoPlayer: cp,
      }]);
    }

    // Step 2 of Takeover/Block/Ghost: special action after normal tile
    if (pwr.active && pwr.firstDone && power?.id === "takeover") {
      if (!cell || cell.wall || cell.owner === cp || cell.visible === false || cell.scored) { toast("Pick an opponent's tile"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { owner: cp, visible: true, anim: "steal" }; setBoard(b); setLastMove([r,c]);
      endTurn(b, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "block") {
      if (cell) { toast("Pick an empty cell for wall"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { wall: true, anim: "wall" }; setBoard(b);
      endTurn(b, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "ghost") {
      if (cell) { toast("Pick an empty cell for ghost"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { owner: cp, visible: false, placedTurn: turn, anim: "ghost" }; setBoard(b); setLastMove([r,c]);
      endTurn(b, { ...cooldowns }); return;
    }

    // Step 1 for all powers (and normal mode): place normal tile
    if (cell) return;
    const b = board.map(row => row.map(x => x ? {...x} : null));
    b[r][c] = { owner: cp, visible: true }; setLastMove([r,c]);

    // Double Place: first tile of a double turn
    if (isPow && power?.id === "doublePlace" && (playerTurns[cp] || 0) % 2 === 1 && !pwr.firstDone) {
      const s = scoreAndMark(b, config.playerCount, config.lineLen, scores);
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

    // Takeover/Block/Ghost: normal tile placed, now prompt for special action
    if (pwr.active && !pwr.firstDone && (power?.id === "takeover" || power?.id === "block" || power?.id === "ghost")) {
      const s = scoreAndMark(b, config.playerCount, config.lineLen, scores);
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
      const prompts = { takeover: "Now steal an opponent's tile", block: "Now place a wall", ghost: "Now place a ghost tile" };
      setPwr({ ...pwr, firstDone: true }); toast(prompts[power.id]); return;
    }

    setBoard(b);
    endTurn(b, { ...cooldowns });
  }, [screen, board, config, cp, onlineSlot, onlinePlayers, cooldowns, pwr, globalTurn, turn, playerTurns, scores, endTurn, toast]);

  const togglePower = useCallback(() => {
    if (screen === "online-game") {
      if (onlineConnRef.current) onlineConnRef.current.powerToggle();
      return;
    }
    if (pwr.active && !pwr.firstDone) { setPwr({ ...pwr, active: false, used: false }); return; }
    if (pwr.active && pwr.firstDone) return; // can't cancel after placing normal tile
    const power = POWERS[config.powers[cp]];
    toast("Place your tile, then use your power");
    setPwr({ ...pwr, active: true, used: true });
  }, [screen, pwr, config, cp, toast]);

  const themedCss = `:root { ${themeVars(theme)} }\n${css}`;
  if (screen === "setup") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><Setup onStart={startGame} onOnline={() => setScreen("online-lobby")} onStats={() => setScreen("stats")} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "stats") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><StatsScreen onBack={() => setScreen("setup")} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "online-lobby") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><OnlineLobby onBack={() => { if (onlineConn) { onlineConn.close(); setOnlineConn(null); } setScreen("setup"); }} onGameStart={handleOnlineGameStart} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;

  const isOnline = screen === "online-game" || screen === "online-review";
  const isReview = screen === "review" || screen === "online-review";
  const isPow = config?.mode === "powers";
  const power = isPow ? POWERS[config.powers[cp]] : null;
  const cd = cooldowns[cp] || 0;
  const hasActiveGhost = isPow && power?.id === "ghost" && board.some(row => row.some(c => c && c.owner === cp && c.visible === false));
  const canUse = isPow && cd === 0 && !pwr.used && power.id !== "doublePlace" && !hasActiveGhost;
  const isDouble = isPow && power?.id === "doublePlace" && (playerTurns[cp] || 0) % 2 === 1;
  const playerColor = PLAYERS[cp];
  const winnerColor = winner !== null ? PLAYERS[winner] : null;

  return (
    <ThemeCtx.Provider value={theme}>
      <style>{themedCss}</style>
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)", userSelect: "none", WebkitUserSelect: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", overflow: "hidden", transition: "background 0.3s" }}>

        {/* Header */}
        <div style={{ background: "var(--card)", borderBottom: "1px solid var(--borderLight)", transition: "background 0.3s" }}>
          {isReview ? (
            <div style={{ padding: "12px 16px", textAlign: "center", animation: "bannerIn 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {winnerColor && <div style={{ width: 14, height: 14, borderRadius: "50%", background: winnerColor.fill, animation: "popIn 0.3s cubic-bezier(0.34,1.56,0.64,1)" }} />}
                <span style={{ fontSize: 17, fontWeight: 700 }}>{isDraw ? "It's a draw!" : `${winnerColor.name} wins!`}</span>
              </div>
              {!isDraw && <p style={{ fontSize: 12, color: "var(--textMuted)", marginTop: 4 }}>Completed {config.linesNeeded} line{config.linesNeeded > 1 ? "s" : ""} of {config.lineLen}</p>}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 10 }}>
              <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } setScreen("setup"); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: "var(--textLabel)" }}>←</button>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: playerColor.fill, boxShadow: `0 0 0 3px ${playerColor.light}`, transition: "background 0.3s, box-shadow 0.3s" }} />
              <span key={cp} style={{ fontSize: 15, fontWeight: 600, flex: 1, color: playerColor.fill, animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
                {isOnline ? (cp === onlineSlot ? "Your turn" : "Opponent's turn") : config.ai && cp === 1 ? "AI thinking..." : `${playerColor.name}'s turn`}
              </span>
              <span style={{ fontSize: 12, color: "var(--textLabel)" }}>Turn {turn}</span>
              {!isOnline && history.length > 0 && !pwr.firstDone && (
                <button className="btn-hover" onClick={undo} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", padding: "4px 10px", color: "var(--textMuted)", fontFamily: "inherit" }}>Undo</button>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 2, padding: "0 16px 8px" }}>
            {Array.from({ length: config.playerCount }).map((_, i) => (
              <div key={i} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 8, transition: "background 0.2s",
                background: (isReview ? i === winner : i === cp) ? PLAYERS[i].light : "var(--surface)",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: PLAYERS[i].fill }} />
                <span key={scores[i] || 0} style={{
                  fontSize: 12, fontWeight: 500,
                  color: (isReview ? i === winner : i === cp) ? PLAYERS[i].fill : "var(--textMuted)",
                  transition: "color 0.3s",
                  animation: (scores[i] || 0) > 0 ? "scoreBump 0.35s cubic-bezier(0.34,1.56,0.64,1)" : undefined,
                }}>
                  {scores[i] || 0}/{config.linesNeeded}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Timer bar */}
        {config.timer > 0 && !isReview && (
          <div style={{ padding: "0 16px", background: "var(--bg)" }}>
            <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: timeLeft <= 5 ? "#F25C54" : playerColor.fill,
                width: `${(timeLeft / config.timer) * 100}%`,
                transition: "width 1s linear, background 0.3s",
              }} />
            </div>
            <div style={{ textAlign: "center", fontSize: 11, color: timeLeft <= 5 ? "#F25C54" : "var(--textLabel)", fontWeight: 600, marginTop: 2 }}>
              {timeLeft}s
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "4px 16px", background: "var(--bg)" }}>
          <button className="btn-hover" onClick={() => setZoom(z => Math.max(20, z - 6))} style={{ width: 28, height: 28, borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--textMuted)" }}>−</button>
          <button className="btn-hover" onClick={() => setZoom(z => Math.min(72, z + 6))} style={{ width: 28, height: 28, borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--textMuted)" }}>+</button>
        </div>

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

        {/* Board */}
        <Board board={board} onCellClick={handleClick} lastMove={lastMove} winCells={winCells}
          currentPlayer={cp} actionMode={pwr.active && pwr.firstDone ? power?.id : null} zoom={zoom} onZoom={setZoom} ghostOwner={isOnline ? onlineSlot : cp} />

        {/* Bottom bar */}
        {isReview ? (
          <div style={{ display: "flex", gap: 10, padding: "10px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
            <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } setScreen("setup"); }} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--surfaceAlt)", color: "var(--text)", fontFamily: "inherit" }}>{isOnline ? "Leave" : "Setup"}</button>
            <button className="btn-hover" onClick={() => isOnline && onlineConnRef.current ? onlineConnRef.current.rematch() : startGame(config)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--btnPrimary)", color: "var(--btnPrimaryText)", fontFamily: "inherit" }}>{isOnline ? "Rematch" : "Play Again"}</button>
          </div>
        ) : isPow && (
          <div key={cp} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", animation: "slideUp 0.2s cubic-bezier(0.16,1,0.3,1)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ opacity: 0.4 }}>{power.icon}</span> {power.name}
                {isDouble && <span style={{ fontSize: 11, background: "#E8EFFE", color: "#4A7BF7", padding: "2px 8px", borderRadius: 6, fontWeight: 500, animation: "popIn 0.2s ease-out" }}>×2 this turn</span>}
                {pwr.firstDone && power.id === "doublePlace" && <span style={{ fontSize: 11, background: "#FDE8E7", color: "#F25C54", padding: "2px 8px", borderRadius: 6, fontWeight: 500, animation: "popIn 0.2s ease-out" }}>2nd tile</span>}
                {pwr.firstDone && power.id !== "doublePlace" && <span style={{ fontSize: 11, background: "#E8EFFE", color: "#4A7BF7", padding: "2px 8px", borderRadius: 6, fontWeight: 500, animation: "popIn 0.2s ease-out" }}>use power</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--textLabel)", marginTop: 2, transition: "color 0.2s" }}>
                {cd > 0 ? `Cooldown: ${cd} turn${cd > 1 ? "s" : ""}` : power.desc}
              </div>
            </div>
            {power.id !== "doublePlace" && !pwr.firstDone && (
              <button className="btn-hover" onClick={togglePower} disabled={!canUse && !pwr.active} style={{
                padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                fontFamily: "inherit", cursor: (canUse || pwr.active) ? "pointer" : "default",
                transition: "all 0.15s",
                background: pwr.active ? "#F25C54" : canUse ? playerColor.fill : "var(--border)",
                color: (canUse || pwr.active) ? "#fff" : "var(--textFaint)",
              }}>{pwr.active ? "Cancel" : "Use"}</button>
            )}
          </div>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}
