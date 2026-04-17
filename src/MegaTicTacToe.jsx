import { useState, useCallback, useRef, useEffect, useMemo, createContext, useContext } from "react";
import {
  PLAYERS, POWERS, getWinConditions, makeBoard, cloneBoard,
  revealGhosts, scoreAndMark, applyPendingLineScore, aiPickMove, aiPickMoveHard, aiPickPowerAction, aiPlanPowerAction,
  canPickLineSlot,
  isBoardFull, getScoredCells, generateRoomCode,
  getBlockSize, getPowerCd, isBlocked, pruneBlocks,
} from "../lib/gameLogic.js";
import { createConnection, subscribeToLobby } from "./multiplayer.js";
import { sfx, haptic, soundEnabled, setSoundEnabled, hapticEnabled, setHapticEnabled } from "./sounds.js";
import { getStats, recordGame, clearStats, getTotalGames, getTotalWins, getWinRate } from "./stats.js";

/** Resolve scoring for AI: always uses the first valid segment on overlong lines. */
function flushScorePending(b, playerCount, lineLen, scoresIn, teams) {
  let r = scoreAndMark(b, playerCount, lineLen, scoresIn, teams);
  while (r.pending) {
    r = applyPendingLineScore(b, playerCount, lineLen, r.pending, 0, r.scores, teams);
  }
  return r.scores;
}

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
  .cell:hover .hover-dot { opacity: 0.22; transform: scale(1); }
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
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("mtt-player-name") || "");
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
    };
    awaitingStartAckRef.current = true;
    setAwaitingStartAck(true);
    conn.setConfig(config);
  }, [conn, mode, gridSize, powers, wc, timerEnabled, timerSeconds, hasDupes]);

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
    const sub = subscribeToLobby(setPublicRooms);
    return () => sub.close();
  }, [tab]);

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
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Your Name</div>
            <input
              type="text"
              placeholder="Enter your name"
              maxLength={20}
              value={playerName}
              onChange={e => { const v = e.target.value; setPlayerName(v); localStorage.setItem("mtt-player-name", v); }}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${t.border}`,
                fontSize: 15, fontWeight: 500, fontFamily: "inherit", background: t.surface, color: t.text,
                outline: "none", marginBottom: 20, boxSizing: "border-box",
              }}
            />
            <button className="btn-hover" onClick={createRoom} style={{
              width: "100%", padding: 16, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
              cursor: "pointer", background: t.btnPrimary, color: t.btnPrimaryText,
              fontFamily: "inherit", marginBottom: 12,
            }}>Create Room</button>
            <div style={{ fontSize: 12, color: t.textLabel, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.5px", margin: "16px 0" }}>or join a friend</div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <input
                type="text"
                placeholder="ABCD"
                maxLength={4}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                style={{
                  flex: 1, minWidth: 0, padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${t.border}`,
                  fontSize: 18, fontWeight: 700, textAlign: "center", letterSpacing: 6,
                  fontFamily: "inherit", background: t.surface, color: t.text, outline: "none",
                }}
              />
              <button className="btn-hover" onClick={joinRoom} style={{
                flexShrink: 0, padding: "12px 20px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600,
                cursor: "pointer", background: "#4A7BF7", color: "#fff", fontFamily: "inherit",
              }}>Join</button>
            </div>
            <button className="btn-hover" onClick={() => setTab("browse")} style={{
              width: "100%", padding: 12, borderRadius: 10, border: `1.5px solid ${t.border}`, fontSize: 13, fontWeight: 500,
              cursor: "pointer", background: t.surface, color: t.textLabel, fontFamily: "inherit", marginTop: 16,
            }}>Browse public rooms</button>
          </div>
        )}

        {tab === "browse" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
              Public rooms ({publicRooms.length})
            </div>
            {publicRooms.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", color: t.textMuted, fontSize: 13, background: t.surface, borderRadius: 10 }}>
                No public rooms right now.<br />
                <span style={{ fontSize: 11 }}>Create one and mark it public to share.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {publicRooms.map(r => (
                  <div key={r.code} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", borderRadius: 10, background: t.surface,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: 2 }}>{r.code}</div>
                      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
                        {r.hostName} · {r.players}/{r.playerCount} · {r.gridSize}×{r.gridSize}
                        {r.mode === "powers" && " · powers"}
                        {r.teams && " · teams"}
                      </div>
                    </div>
                    <button className="btn-hover" disabled={r.players >= r.playerCount} onClick={() => { setJoinCode(r.code); setTab("join"); connectToRoom(r.code, false); }} style={{
                      padding: "6px 14px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                      cursor: r.players >= r.playerCount ? "default" : "pointer",
                      background: r.players >= r.playerCount ? t.border : "#4A7BF7", color: "#fff", fontFamily: "inherit",
                      opacity: r.players >= r.playerCount ? 0.5 : 1,
                    }}>{r.players >= r.playerCount ? "Full" : "Join"}</button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-hover" onClick={() => setTab("menu")} style={{
              width: "100%", padding: 10, borderRadius: 10, border: `1.5px solid ${t.border}`, fontSize: 13,
              cursor: "pointer", background: "transparent", color: t.textLabel, fontFamily: "inherit", marginTop: 14,
            }}>Back</button>
          </div>
        )}

        {(tab === "create" || tab === "join") && (
          <div style={{ marginTop: 24 }}>
            {status === "connecting" && (
              <div style={{
                padding: "8px 14px", borderRadius: 10, marginBottom: 16,
                display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: t.textMuted,
                background: `linear-gradient(90deg, ${t.surface} 0%, ${t.surfaceAlt} 50%, ${t.surface} 100%)`,
                backgroundSize: "200% 100%", animation: "skeletonShimmer 1.5s linear infinite",
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4A7BF7", animation: "pulse 1.5s infinite" }} />
                Connecting to room...
              </div>
            )}
            {/* Room code display */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Room Code</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: "#4A7BF7" }}>{roomCode}</span>
                <button className="btn-hover" onClick={copyCode} style={{
                  background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8,
                  padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.textMuted, fontFamily: "inherit",
                }}>{copied ? "Copied!" : "Copy"}</button>
                <button className="btn-hover" onClick={copyLink} style={{
                  background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8,
                  padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.textMuted, fontFamily: "inherit",
                }}>{linkCopied ? "Link copied!" : "Share link"}</button>
              </div>
              {isHost && (
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: t.textMuted }}>List publicly</span>
                  <button onClick={() => setIsPublic(v => !v)} style={{
                    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                    background: isPublic ? "#4A7BF7" : t.border, position: "relative", transition: "background 0.2s",
                  }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%", background: t.card, position: "absolute", top: 2,
                      left: isPublic ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                    }} />
                  </button>
                </div>
              )}
            </div>

            {/* Your name (editable in-lobby) */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Your Name</div>
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
                  width: "100%", padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${t.border}`,
                  fontSize: 14, fontWeight: 500, fontFamily: "inherit", background: t.surface, color: t.text,
                  outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Players */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Players</div>
              {Array.from({ length: playerCount }, (_, slot) => slot).map(slot => {
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

                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#4A7BF7" }}>{gridSize}×{gridSize}</span>
                  </div>
                  <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {[2, 3, 4].map(n => {
                      // Can't shrink below currently-joined count
                      const disabled = n < seatedPlayers.length;
                      return (
                        <button key={n} disabled={disabled} onClick={() => setPlayerCount(n)} style={{
                          width: 44, height: 44, borderRadius: 10, fontSize: 16, fontWeight: 600,
                          cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.15s", opacity: disabled ? 0.35 : 1,
                          border: playerCount === n ? "2px solid #4A7BF7" : `1.5px solid ${t.border}`,
                          background: playerCount === n ? "#E8EFFE" : t.card,
                          color: playerCount === n ? "#4A7BF7" : t.textMuted,
                        }}>{n}</button>
                      );
                    })}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{
                          width: 12, height: 12, borderRadius: "50%", background: PLAYERS[i].fill,
                          transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s",
                          transform: i < playerCount ? "scale(1)" : "scale(0)",
                          opacity: i < playerCount ? 1 : 0,
                        }} />
                      ))}
                    </div>
                  </div>
                </div>

                <Collapse open={mode === "powers"} maxH={260}>
                  <div style={{ marginBottom: 16, paddingBottom: 2 }}>
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

                <div style={{ marginBottom: 4, background: t.surface, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, color: t.textLabel, fontWeight: 500, marginBottom: 4 }}>Win condition</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
                    {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
                    {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: "#4A7BF7", marginLeft: 6 }}>custom</span>}
                  </div>
                </div>

                <button onClick={() => setShowAdvanced(v => !v)} style={{
                  width: "100%", padding: "10px 0", border: "none", background: "none",
                  fontSize: 13, color: t.textLabel, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}>
                  <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
                  Advanced settings
                </button>

                <Collapse open={showAdvanced} maxH={400}>
                  <div style={{ background: t.surface, borderRadius: 10, padding: "14px", marginTop: 4, marginBottom: 16 }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: customLineLen !== null ? "#4A7BF7" : t.text }}>{wc.lineLen}</span>
                      </div>
                      <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                        onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: customLinesNeeded !== null ? "#4A7BF7" : t.text }}>{wc.linesNeeded}</span>
                      </div>
                      <input type="range" min={1} max={5} value={wc.linesNeeded}
                        onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
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

                <button className="btn-hover" onClick={startGame} disabled={!opponentJoined || hasDupes} style={{
                  width: "100%", padding: 14, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
                  cursor: (opponentJoined && !hasDupes) ? "pointer" : "default", background: t.btnPrimary, color: t.btnPrimaryText,
                  fontFamily: "inherit", opacity: (opponentJoined && !hasDupes) ? 1 : 0.4,
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "modalFadeIn 0.22s ease-out" }}>
      <div style={{ background: t.card, borderRadius: 16, padding: "28px 24px", maxWidth: 380, width: "100%", boxShadow: "0 20px 40px rgba(0,0,0,0.3)", animation: "modalCardIn 0.32s cubic-bezier(0.16,1,0.3,1)" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? "#4A7BF7" : t.border, transition: "background 0.3s" }} />
          ))}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: t.text, marginBottom: 10 }}>{s.title}</h2>
        <p style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.5, marginBottom: 24 }}>{s.body}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 13, color: t.textLabel, cursor: "pointer", fontFamily: "inherit", padding: "8px 4px" }}>Skip</button>
          <button className="btn-hover" onClick={() => last ? onClose() : setStep(step + 1)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: t.btnPrimary, color: t.btnPrimaryText, fontFamily: "inherit" }}>
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Setup({ onStart, onOnline, onStats, onResume, dark, setDark }) {
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

  return (
    <div style={{ minHeight: "100dvh", background: t.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none", transition: "background 0.3s" }}>
      {showTutorial && <Tutorial onClose={closeTutorial} />}
      <div style={{ background: t.card, borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 420, boxShadow: t.cardShadow, animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", transition: "background 0.3s, box-shadow 0.3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setShowTutorial(true)} title="How to play" style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, opacity: 0.6 }}>?</button>
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

        {playerCount === 4 && (
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textLabel, letterSpacing: "0.5px", textTransform: "uppercase" }}>Team mode</div>
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 2 }}>{teams ? "Blue + Sage vs Coral + Amber" : "Free-for-all"}</div>
            </div>
            <button onClick={() => setTeams(v => !v)} style={{
              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
              background: teams ? "#4A7BF7" : t.border, position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: "50%", background: t.card, position: "absolute", top: 2,
                left: teams ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }} />
            </button>
          </div>
        )}

        {playerCount === 2 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
            <Collapse open={vsAI} maxH={80}>
              <div style={{ display: "flex", background: t.surfaceAlt, borderRadius: 10, padding: 3, gap: 2, marginTop: 10 }}>
                {["easy", "medium", "hard"].map(d => (
                  <button key={d} onClick={() => setAiDifficulty(d)} style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
                    background: aiDifficulty === d ? t.card : "transparent",
                    color: aiDifficulty === d ? t.text : t.textMuted,
                    boxShadow: aiDifficulty === d ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  }}>{d}</button>
                ))}
              </div>
            </Collapse>
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

        {hasSaved && onResume && (
          <button className="btn-hover" onClick={onResume} style={{
            width: "100%", padding: 12, borderRadius: 12, border: `1.5px solid ${t.btnPrimary}`, fontSize: 14, fontWeight: 600,
            cursor: "pointer", background: t.surface, color: t.btnPrimary,
            fontFamily: "inherit", marginTop: 18,
          }}>Resume last game</button>
        )}
        <button className="btn-hover" onClick={() => !hasDupes && onStart({ mode, gridSize, playerCount, powers: powers.slice(0, playerCount), ...wc, timer: timerEnabled ? timerSeconds : 0, ai: vsAI && playerCount === 2, aiDifficulty, teams: teams && playerCount === 4 })}
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
        {installEvent && (
          <button className="btn-hover" onClick={installApp} style={{
            width: "100%", padding: 10, borderRadius: 12, border: `1.5px solid ${t.border}`, fontSize: 13, fontWeight: 500,
            cursor: "pointer", background: t.surface, color: t.textLabel,
            fontFamily: "inherit", marginTop: 8,
          }}>Install app</button>
        )}
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
      <div style={{ position: "relative", flexShrink: 0 }}>
      <div key={`pulse-${currentPlayer}`} style={{
        position: "absolute", inset: -10, borderRadius: 14, pointerEvents: "none",
        boxShadow: `inset 0 0 24px 2px ${PLAYERS[currentPlayer].fill}`,
        animation: "turnGlow 0.95s cubic-bezier(0.22,1,0.36,1) forwards", opacity: 0,
      }} />
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
              width: cellSize, height: cellSize, background: cellBlocked ? "var(--cellWall)" : (isWall ? "var(--cellWall)" : "var(--cell)"),
              borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: clickable ? "pointer" : "default",
              position: "relative", transition: "background 0.2s",
            }}>
              {cellBlocked && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 3,
                  backgroundImage: `repeating-linear-gradient(45deg, ${t.textFaint}33 0 3px, transparent 3px 7px)`,
                  pointerEvents: "none",
                }} />
              )}
              {trailIdx > 0 && owned && (
                <div style={{
                  position: "absolute", inset: 2, borderRadius: "50%",
                  boxShadow: `0 0 0 1.5px ${PLAYERS[cell.owner].fill}${trailIdx === 1 ? "55" : "22"}`,
                  pointerEvents: "none",
                }} />
              )}
              {cursor && cursor[0] === r && cursor[1] === c && (
                <div style={{
                  position: "absolute", inset: -2, borderRadius: 4,
                  border: `2px solid ${PLAYERS[currentPlayer].fill}`,
                  boxShadow: `0 0 0 2px ${PLAYERS[currentPlayer].fill}22`,
                  pointerEvents: "none",
                }} />
              )}
              {isTpSource && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: 3,
                  border: `2px dashed ${PLAYERS[currentPlayer].fill}`,
                  animation: "slideUp 0.2s ease-out",
                  pointerEvents: "none",
                }} />
              )}
              {clickable && !cell && (
                <>
                  <div className="cell-hover" style={{
                    position: "absolute", inset: 0, borderRadius: 3, transition: "background 0.15s",
                  }} />
                  <div className="hover-dot" style={{
                    position: "absolute", width: cellSize * 0.55, height: cellSize * 0.55, borderRadius: "50%",
                    background: PLAYERS[currentPlayer].fill, opacity: 0, transform: "scale(0.6)",
                    transition: "opacity 0.18s, transform 0.18s cubic-bezier(0.34,1.56,0.64,1)", pointerEvents: "none",
                  }} />
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
              {linePick && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 3,
                  border: `2px dashed ${color?.ring || "var(--textMuted)"}`,
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
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  // Online multiplayer state
  const [onlineConn, setOnlineConn] = useState(null);
  const [onlineSlot, setOnlineSlot] = useState(-1);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [connState, setConnState] = useState("connected"); // connected | reconnecting
  const [emoteFeed, setEmoteFeed] = useState([]); // [{id, slot, name, emote, at}]
  const [rematchVote, setRematchVote] = useState({ votedSlots: [], needed: 0, count: 0 });
  const onlineConnRef = useRef(null);
  /** Longer-than-needed line: player must pick a contiguous segment (sync with server `pendingLinePick`). */
  const [pendingLinePick, setPendingLinePick] = useState(null);

  const toast = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(null), 1600); }, []);

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
      setMsg(null); setHistory([]); setReplayIdx(null);
      setTimeLeft(snap.config.timer || 0);
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
    setMsg(null); setHistory([]); setReplayIdx(null);
    setTimeLeft(cfg.timer || 0);
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
    if (msg.timeLeft !== undefined) setTimeLeft(msg.timeLeft);
    if (msg.you !== undefined) setOnlineSlot(msg.you);
    if (msg.players) setOnlinePlayers(msg.players);
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
          if (prev.find(p => p.slot === msg.slot)) {
            return prev.map(p => p.slot === msg.slot ? { ...p, name: msg.name } : p);
          }
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
          easy: { takeover: 300, block: 260, teleport: 40 },
          medium: { takeover: 200, block: 180, teleport: 24 },
          hard: { takeover: 120, block: 110, teleport: 12 },
        };
        const scoreReq = (minScore[diff] || minScore.medium)[power.id] ?? 180;
        const earlyTeleport = power.id === "teleport" && ownTiles < 3;
        const teleportEarlyReq = 240;
        if (plan && plan.action && plan.score >= scoreReq) {
          if (!earlyTeleport || plan.score >= teleportEarlyReq) {
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
    setHistory(h => h.slice(0, -1));
    setBoard(snap.board); setCp(snap.cp); setTurn(snap.turn);
    setGlobalTurn(snap.globalTurn); setScores(snap.scores);
    setCooldowns(snap.cooldowns); setPlayerTurns(snap.playerTurns);
    setLastMove(snap.lastMove); setWinCells([]); setWinner(null);
    setIsDraw(false); setPwr({ active: false, used: false, firstDone: false });
    setPendingLinePick(null);
    setScreen("game"); setMsg(null);
    toast(`Undid ${PLAYERS[snap.undoPlayer].name}'s move`);
  }, [history, toast]);

  const handleClick = useCallback((r, c) => {
    // Online mode: send move to server
    if (screen === "online-game") {
      if (pendingLinePick) {
        if (canPickLineSlot(pendingLinePick.pending, onlineSlot)) toast("Use the buttons to choose your line");
        else toast("Waiting for line choice");
        return;
      }
      const requiredPlayers = config?.playerCount || 2;
      if (onlinePlayers.length < requiredPlayers) { toast("Waiting for players"); return; }
      if (cp !== onlineSlot) { toast("Opponent's turn"); return; }
      if (onlineConnRef.current) onlineConnRef.current.move(r, c);
      return;
    }
    if (screen !== "game") return;
    if (pendingLinePick) { toast("Choose which segment counts for your line"); return; }
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
  }, [screen, board, blocks, config, cp, onlineSlot, onlinePlayers, cooldowns, pwr, globalTurn, turn, playerTurns, scores, endTurn, toast, pendingLinePick, teamsArr]);

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
  if (screen === "setup") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><Setup onStart={startGame} onOnline={() => setScreen("online-lobby")} onStats={() => setScreen("stats")} onResume={resumeGame} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "stats") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><StatsScreen onBack={() => setScreen("setup")} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
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
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)", userSelect: "none", WebkitUserSelect: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", overflow: "hidden", transition: "background 0.3s" }}>
        {isReview && !isDraw && winnerColor && <Confetti color={winnerColor.fill} />}

        {/* Header */}
        <div style={{ background: "var(--card)", borderBottom: "1px solid var(--borderLight)", transition: "background 0.3s" }}>
          {isReview ? (
            <div style={{
              padding: "18px 16px", textAlign: "center", animation: "bannerSlide 0.5s cubic-bezier(0.34,1.56,0.64,1)",
              background: isDraw
                ? "var(--card)"
                : `radial-gradient(ellipse 80% 140% at 50% 0%, ${winnerColor.fill}55 0%, ${winnerColor.fill}22 35%, ${winnerColor.fill}08 65%, var(--card) 100%)`,
              position: "relative", overflow: "hidden",
            }}>
              {!isDraw && (
                <div style={{
                  position: "absolute", top: 0, left: 0, width: "40%", height: "100%",
                  background: `linear-gradient(100deg, transparent 0%, ${winnerColor.fill}33 50%, transparent 100%)`,
                  animation: "bannerShine 1.6s ease-out 0.3s",
                  pointerEvents: "none",
                }} />
              )}
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                {winnerColor && <div style={{ width: 20, height: 20, borderRadius: "50%", background: winnerColor.fill, boxShadow: `0 0 0 5px ${winnerColor.fill}33, 0 2px 12px ${winnerColor.fill}80`, animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }} />}
                <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.3px", color: isDraw ? "var(--text)" : winnerColor.fill, textShadow: isDraw ? undefined : `0 1px 8px ${winnerColor.fill}40` }}>
                  {isDraw ? "It's a draw!" : `${winnerColor.name} wins!`}
                </span>
              </div>
              {!isDraw && <p style={{ position: "relative", fontSize: 12, color: "var(--textMuted)", marginTop: 6 }}>Completed {config.linesNeeded} line{config.linesNeeded > 1 ? "s" : ""} of {config.lineLen}</p>}
              {isDraw && (
                <div style={{ position: "relative", marginTop: 10, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                  {Array.from({ length: config.playerCount }).map((_, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", borderRadius: 8, background: "var(--surface)",
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: PLAYERS[i].fill }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: PLAYERS[i].fill }}>{PLAYERS[i].name}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{scores[i] || 0}</span>
                      <span style={{ fontSize: 11, color: "var(--textMuted)" }}>/ {config.linesNeeded}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 10 }}>
              <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } setScreen("setup"); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: "var(--textLabel)" }}>←</button>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: playerColor.fill, boxShadow: `0 0 0 3px ${playerColor.light}`, transition: "background 0.3s, box-shadow 0.3s" }} />
              <span key={cp} style={{ fontSize: 15, fontWeight: 600, flex: 1, color: playerColor.fill, animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}>
                {isOnline ? (() => {
                  const p = onlinePlayers.find(p => p.slot === cp);
                  const nm = p?.name || (cp === onlineSlot ? "You" : "Opponent");
                  return cp === onlineSlot ? "Your turn" : `${nm}'s turn`;
                })() : config.ai && cp === 1 ? "AI thinking..." : `${playerColor.name}'s turn`}
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
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  color: (isReview ? i === winner : i === cp) ? PLAYERS[i].fill : "var(--textMuted)",
                  transition: "color 0.3s",
                  display: "inline-flex", alignItems: "center",
                }}>
                  <RollingNumber value={scores[i] || 0} />/{config.linesNeeded}
                </span>
              </div>
            ))}
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

        {/* Emote feed (floating, top-right) */}
        {isOnline && emoteFeed.length > 0 && (
          <div style={{ position: "fixed", top: 70, right: 12, zIndex: 50, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
            {emoteFeed.map(e => (
              <div key={e.id} style={{
                background: "var(--card)", borderRadius: 16, padding: "6px 12px",
                fontSize: 14, color: "var(--text)", boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                display: "flex", alignItems: "center", gap: 8,
                animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)",
                borderLeft: `3px solid ${PLAYERS[e.slot]?.fill || "#888"}`,
              }}>
                <strong style={{ fontSize: 12, color: PLAYERS[e.slot]?.fill || "#888" }}>{e.name}</strong>
                <span>{e.emote}</span>
              </div>
            ))}
          </div>
        )}

        {/* Emote bar */}
        {isOnline && !isReview && onlineSlot >= 0 && (
          <div style={{ display: "flex", gap: 6, padding: "6px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", justifyContent: "center" }}>
            {["GG", "😂", "🤔", "👀", "🔥", "😭"].map(e => (
              <button key={e} className="btn-hover" onClick={() => onlineConnRef.current?.emote(e)} style={{
                padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--surface)", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              }}>{e}</button>
            ))}
          </div>
        )}

        {/* Reconnect banner */}
        {isOnline && connState === "reconnecting" && (
          <ReconnectBanner />
        )}

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
          <button className="btn-hover" onClick={() => tweenZoom(-8)} style={{ width: 28, height: 28, borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--textMuted)" }}>−</button>
          <button className="btn-hover" onClick={() => tweenZoom(8)} style={{ width: 28, height: 28, borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--textMuted)" }}>+</button>
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

        {/* Replay scrubber (review only, needs history) */}
        {isReview && history.length > 0 && (
          <div style={{ padding: "8px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--textMuted)", minWidth: 44 }}>
              {replayIdx === null ? `Final` : `Move ${replayIdx + 1}/${history.length}`}
            </span>
            <input type="range" min={0} max={history.length} step={1}
              value={replayIdx === null ? history.length : replayIdx}
              onChange={e => {
                const v = +e.target.value;
                setReplayIdx(v === history.length ? null : v);
              }}
              style={{ flex: 1, cursor: "pointer" }} />
            <button className="btn-hover" onClick={() => setReplayIdx(null)} style={{
              padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--surface)", fontSize: 11, cursor: "pointer", fontFamily: "inherit", color: "var(--textMuted)",
            }}>Live</button>
          </div>
        )}

        {/* Bottom bar */}
        {isReview ? (
          <div style={{ display: "flex", gap: 10, padding: "10px 16px", background: "var(--card)", borderTop: "1px solid var(--borderLight)", animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1)" }}>
            <button className="btn-hover" onClick={() => { if (isOnline && onlineConn) { onlineConn.close(); setOnlineConn(null); } setScreen("setup"); }} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--surfaceAlt)", color: "var(--text)", fontFamily: "inherit" }}>{isOnline ? "Leave" : "Setup"}</button>
            <button className="btn-hover" onClick={shareSnapshot} style={{ padding: "12px 14px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--surfaceAlt)", color: "var(--text)", fontFamily: "inherit" }} title="Share board image">Share</button>
            <button className="btn-hover" disabled={isOnline && rematchVote.votedSlots.includes(onlineSlot)} onClick={() => isOnline && onlineConnRef.current ? onlineConnRef.current.rematch() : startGame(config)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--btnPrimary)", color: "var(--btnPrimaryText)", fontFamily: "inherit", opacity: isOnline && rematchVote.votedSlots.includes(onlineSlot) ? 0.6 : 1 }}>{isOnline ? (rematchVote.votedSlots.includes(onlineSlot) ? `Waiting ${rematchVote.count}/${rematchVote.needed}` : (rematchVote.needed > 0 ? `Rematch ${rematchVote.count}/${rematchVote.needed}` : "Rematch")) : "Play Again"}</button>
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
              <div style={{ position: "relative" }}>
                <button className="btn-hover" onClick={togglePower} disabled={!canUse && !pwr.active} style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                  fontFamily: "inherit", cursor: (canUse || pwr.active) ? "pointer" : "default",
                  transition: "all 0.15s",
                  background: pwr.active ? "#F25C54" : canUse ? playerColor.fill : "var(--border)",
                  color: (canUse || pwr.active) ? "#fff" : "var(--textFaint)",
                }}>{pwr.active ? "Cancel" : "Use"}</button>
                {cd > 0 && !pwr.active && (
                  <div style={{
                    position: "absolute", top: -6, right: -6,
                    minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                    background: "#F25C54", color: "#fff", fontSize: 11, fontWeight: 700,
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
