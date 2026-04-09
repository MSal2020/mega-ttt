import { useState, useCallback, useRef, useEffect } from "react";

const PLAYERS = [
  { fill: "#4A7BF7", light: "#E8EFFE", name: "Blue", ring: "#a4bcfb" },
  { fill: "#F25C54", light: "#FDE8E7", name: "Coral", ring: "#f9a8a5" },
  { fill: "#4DAA6D", light: "#E3F3E8", name: "Sage", ring: "#96d4a9" },
  { fill: "#F2A93B", light: "#FDF1DC", name: "Amber", ring: "#f7cf8a" },
];

const POWERS = [
  { id: "doublePlace", name: "Double Place", desc: "2 tiles every other turn", cd: 0, icon: "◇" },
  { id: "takeover", name: "Takeover", desc: "Steal an opponent's tile", cd: 3, icon: "△" },
  { id: "block", name: "Block", desc: "Drop a permanent wall", cd: 3, icon: "□" },
  { id: "ghost", name: "Ghost", desc: "Place a hidden tile", cd: 0, icon: "○" },
];

function getWinConditions(gs, pc) {
  if (gs <= 9) return { lineLen: 4, linesNeeded: pc <= 3 ? 2 : 1 };
  if (gs <= 14) return { lineLen: 5, linesNeeded: pc <= 3 ? 2 : 1 };
  return { lineLen: 5, linesNeeded: pc <= 3 ? 3 : 2 };
}

function makeBoard(n) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => null));
}

function findLines(board, pid, len) {
  const n = board.length, dirs = [[0,1],[1,0],[1,1],[1,-1]], found = [];
  const used = new Set(); // cells already part of a scored line in a given direction
  for (const [dr,dc] of dirs) {
    const dirKey = `${dr},${dc}`;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (used.has(`${dirKey},${r},${c}`)) continue;
      // extend as far as possible in this direction
      const cells = [];
      for (let i = 0; ; i++) {
        const nr = r+dr*i, nc = c+dc*i;
        if (nr<0||nr>=n||nc<0||nc>=n) break;
        const cell = board[nr][nc];
        if (cell && cell.owner === pid && !cell.wall && cell.visible !== false && !cell.scored) cells.push([nr,nc]);
        else break;
      }
      if (cells.length >= len) {
        found.push(cells);
        for (const [cr,cc] of cells) used.add(`${dirKey},${cr},${cc}`);
      }
    }
  }
  return found;
}

function revealGhosts(board, gTurn) {
  return board.map(row => row.map(c => {
    if (c && c.visible === false && gTurn - c.placedTurn >= 2) return { ...c, visible: true };
    return c ? { ...c } : null;
  }));
}


function scoreAndMark(board, pc, lineLen, prevScores) {
  // 1. Count new lines (before marking)
  const s = {};
  for (let p = 0; p < pc; p++) s[p] = (prevScores[p] || 0);
  // 2. Mark one line at a time, incrementing score each time
  let found = true;
  while (found) {
    found = false;
    for (let p = 0; p < pc; p++) {
      const lines = findLines(board, p, lineLen);
      if (lines.length > 0) {
        s[p]++;
        for (const [r,c] of lines[0]) {
          board[r][c] = { ...board[r][c], scored: true };
        }
        found = true;
        break; // restart so findLines re-evaluates
      }
    }
  }
  return s;
}

const css = `
  @keyframes popIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(74,123,247,0.3); } 50% { box-shadow: 0 0 0 6px rgba(74,123,247,0); } }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  input[type=range] { accent-color: #4A7BF7; }
`;

function Setup({ onStart }) {
  const [mode, setMode] = useState("normal");
  const [gridSize, setGridSize] = useState(12);
  const [playerCount, setPlayerCount] = useState(2);
  const [powers, setPowers] = useState([0, 1, 2, 3]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLineLen, setCustomLineLen] = useState(null);
  const [customLinesNeeded, setCustomLinesNeeded] = useState(null);
  const autoWc = getWinConditions(gridSize, playerCount);
  const wc = {
    lineLen: customLineLen ?? autoWc.lineLen,
    linesNeeded: customLinesNeeded ?? autoWc.linesNeeded,
  };
  const usedPowers = powers.slice(0, playerCount);
  const hasDupes = mode === "powers" && new Set(usedPowers).size < usedPowers.length;

  return (
    <div style={{ minHeight: "100vh", background: "#F7F6F3", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, userSelect: "none" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 420, boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px", textAlign: "center" }}>Mega Tic Tac Toe</h1>
        <p style={{ fontSize: 14, color: "#888", textAlign: "center", marginTop: 6 }}>Customise your game</p>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
          <div style={{ display: "flex", background: "#F0EFEC", borderRadius: 10, padding: 3, gap: 2 }}>
            {["normal", "powers"].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "8px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500,
                cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                background: mode === m ? "#fff" : "transparent", color: mode === m ? "#1a1a1a" : "#888",
                boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>{m === "normal" ? "Normal" : "Powers"}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
            <span style={{ fontSize: 20, fontWeight: 700, color: "#4A7BF7" }}>{gridSize}×{gridSize}</span>
          </div>
          <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#bbb", marginTop: 2 }}>
            <span>7×7</span><span>20×20</span>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[2, 3, 4].map(n => (
              <button key={n} onClick={() => setPlayerCount(n)} style={{
                width: 48, height: 48, borderRadius: 10, fontSize: 18, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
                border: playerCount === n ? "2px solid #4A7BF7" : "1.5px solid #E5E4E0",
                background: playerCount === n ? "#E8EFFE" : "#fff",
                color: playerCount === n ? "#4A7BF7" : "#666",
              }}>{n}</button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {Array.from({ length: playerCount }).map((_, i) => (
                <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", background: PLAYERS[i].fill }} />
              ))}
            </div>
          </div>
        </div>

        {mode === "powers" && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Assign powers</div>
            {Array.from({ length: playerCount }).map((_, pi) => (
              <div key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: "#FAFAF8", borderRadius: 10, padding: "8px 12px", marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: PLAYERS[pi].fill, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, width: 48, flexShrink: 0 }}>{PLAYERS[pi].name}</span>
                <select value={powers[pi]} onChange={e => { const p = [...powers]; p[pi] = +e.target.value; setPowers(p); }}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #E5E4E0", fontSize: 13, fontFamily: "inherit", background: "#fff", color: "#1a1a1a" }}>
                  {POWERS.map((pw, wi) => <option key={wi} value={wi}>{pw.icon} {pw.name}</option>)}
                </select>
              </div>
            ))}
            {hasDupes && <p style={{ fontSize: 12, color: "#F25C54", marginTop: 4 }}>Each player should have a unique power</p>}
          </div>
        )}

        <div style={{ marginTop: 22, background: "#FAFAF8", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "#999", fontWeight: 500, marginBottom: 4 }}>Win condition</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
            {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: "#4A7BF7", marginLeft: 6 }}>custom</span>}
          </div>
        </div>

        <button onClick={() => setShowAdvanced(v => !v)} style={{
          width: "100%", padding: "10px 0", border: "none", background: "none",
          fontSize: 13, color: "#999", cursor: "pointer", fontFamily: "inherit",
          marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
          Advanced settings
        </button>

        {showAdvanced && (
          <div style={{ background: "#FAFAF8", borderRadius: 10, padding: "14px", marginTop: 4 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: customLineLen !== null ? "#4A7BF7" : "#1a1a1a" }}>{wc.lineLen}</span>
              </div>
              <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#bbb", marginTop: 2 }}>
                <span>3</span><span>{Math.min(gridSize, 8)}</span>
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#999", letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                <span style={{ fontSize: 16, fontWeight: 700, color: customLinesNeeded !== null ? "#4A7BF7" : "#1a1a1a" }}>{wc.linesNeeded}</span>
              </div>
              <input type="range" min={1} max={5} value={wc.linesNeeded}
                onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                style={{ width: "100%", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#bbb", marginTop: 2 }}>
                <span>1</span><span>5</span>
              </div>
            </div>
            {(customLineLen !== null || customLinesNeeded !== null) && (
              <button onClick={() => { setCustomLineLen(null); setCustomLinesNeeded(null); }} style={{
                width: "100%", padding: 8, borderRadius: 8, border: "1.5px solid #E5E4E0",
                background: "#fff", fontSize: 12, color: "#999", cursor: "pointer",
                fontFamily: "inherit", marginTop: 10,
              }}>Reset to default</button>
            )}
          </div>
        )}

        <button onClick={() => !hasDupes && onStart({ mode, gridSize, playerCount, powers: powers.slice(0, playerCount), ...wc })}
          style={{
            width: "100%", padding: 14, borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
            cursor: hasDupes ? "default" : "pointer", background: "#1a1a1a", color: "#fff",
            fontFamily: "inherit", marginTop: 24, opacity: hasDupes ? 0.4 : 1,
            transition: "opacity 0.15s",
          }}>Start Game</button>
      </div>
    </div>
  );
}

function Board({ board, onCellClick, lastMove, winCells, currentPlayer, actionMode, zoom, onZoom, ghostOwner }) {
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
    ctx.fillStyle = "#E5E4E0";
    ctx.fillRect(0, 0, miniSize, miniSize);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (cell && cell.wall) ctx.fillStyle = "#ccc";
      else if (cell && !cell.wall && cell.visible !== false) ctx.fillStyle = PLAYERS[cell.owner].fill;
      else ctx.fillStyle = "#fff";
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
  }, [miniState, board, n]);

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
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 12, minHeight: 0, background: "#F7F6F3", position: "relative",
    }}>
      {miniState.show && (
        <canvas ref={miniRef} onClick={onMiniClick} style={{
          position: "fixed", bottom: 70, right: 12, width: 90, height: 90,
          borderRadius: 8, border: "1.5px solid #E5E4E0", background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)", cursor: "pointer", zIndex: 40,
        }} />
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${n}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${n}, ${cellSize}px)`,
        gap, background: "#E5E4E0", borderRadius: 6, padding: gap, flexShrink: 0,
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

          return (
            <div key={`${r}-${c}`} onClick={() => onCellClick(r, c)} style={{
              width: cellSize, height: cellSize, background: isWall ? "#EEEDEA" : "#fff",
              borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: ((!cell && !actionMode) || stealTarget || (actionMode === "block" && !cell) || (actionMode === "ghost" && !cell)) ? "pointer" : "default",
              position: "relative",
            }}>
              {isWall && (
                <svg width={cellSize * 0.45} height={cellSize * 0.45} viewBox="0 0 20 20" style={{ opacity: 0.35 }}>
                  <line x1="4" y1="4" x2="16" y2="16" stroke="#888" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="16" y1="4" x2="4" y2="16" stroke="#888" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              )}
              {owned && (
                <div style={{
                  width: cellSize * 0.6, height: cellSize * 0.6, borderRadius: "50%",
                  background: color.fill,
                  opacity: isScored ? 0.35 : 1,
                  animation: last ? "popIn 0.25s cubic-bezier(0.34,1.56,0.64,1)" : undefined,
                  boxShadow: won ? `0 0 0 3px ${color.ring}` : undefined,
                  transition: "box-shadow 0.3s, opacity 0.3s",
                }} />
              )}
              {showGhost && (
                <div style={{
                  width: cellSize * 0.55, height: cellSize * 0.55, borderRadius: "50%",
                  border: `2px dashed ${PLAYERS[cell.owner].ring}`, opacity: 0.5,
                }} />
              )}
              {isGhost && !showGhost && (
                <div style={{ width: cellSize * 0.25, height: cellSize * 0.25, borderRadius: "50%", background: "#ddd" }} />
              )}
              {stealTarget && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: 3,
                  border: "2px solid #F25C54", background: "rgba(242,92,84,0.06)",
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
  const [screen, setScreen] = useState("setup");
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

  const toast = useCallback((t) => { setMsg(t); setTimeout(() => setMsg(null), 1600); }, []);

  const startGame = useCallback((cfg) => {
    setConfig(cfg);
    setBoard(makeBoard(cfg.gridSize));
    setCp(0); setTurn(1); setGlobalTurn(1);
    setScores({}); setCooldowns({}); setPlayerTurns({}); setLastMove(null);
    setWinCells([]); setWinner(null); setIsDraw(false);
    setPwr({ active: false, used: false, firstDone: false });
    setMsg(null); setHistory([]);
    setZoom(Math.min(52, Math.max(28, Math.floor(320 / cfg.gridSize))));
    setScreen("game");
  }, []);

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
  }, [config, cp, globalTurn, turn, scores]);

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
    if (screen !== "game") return;
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
      b[r][c] = { owner: cp, visible: true }; setBoard(b); setLastMove([r,c]);
      endTurn(b, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "block") {
      if (cell) { toast("Pick an empty cell for wall"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { wall: true }; setBoard(b);
      endTurn(b, { ...cooldowns, [cp]: POWERS[config.powers[cp]].cd }); return;
    }
    if (pwr.active && pwr.firstDone && power?.id === "ghost") {
      if (cell) { toast("Pick an empty cell for ghost"); return; }
      const b = board.map(row => row.map(x => x ? {...x} : null));
      b[r][c] = { owner: cp, visible: false, placedTurn: turn }; setBoard(b); setLastMove([r,c]);
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
  }, [screen, board, config, cp, cooldowns, pwr, globalTurn, turn, playerTurns, scores, endTurn, toast]);

  const togglePower = useCallback(() => {
    if (pwr.active && !pwr.firstDone) { setPwr({ ...pwr, active: false, used: false }); return; }
    if (pwr.active && pwr.firstDone) return; // can't cancel after placing normal tile
    const power = POWERS[config.powers[cp]];
    toast("Place your tile, then use your power");
    setPwr({ ...pwr, active: true, used: true });
  }, [pwr, config, cp, toast]);

  if (screen === "setup") return <><style>{css}</style><Setup onStart={startGame} /></>;

  const isReview = screen === "review";
  const isPow = config.mode === "powers";
  const power = isPow ? POWERS[config.powers[cp]] : null;
  const cd = cooldowns[cp] || 0;
  const hasActiveGhost = isPow && power?.id === "ghost" && board.some(row => row.some(c => c && c.owner === cp && c.visible === false));
  const canUse = isPow && cd === 0 && !pwr.used && power.id !== "doublePlace" && !hasActiveGhost;
  const isDouble = isPow && power?.id === "doublePlace" && (playerTurns[cp] || 0) % 2 === 1;
  const playerColor = PLAYERS[cp];
  const winnerColor = winner !== null ? PLAYERS[winner] : null;

  return (
    <>
      <style>{css}</style>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#F7F6F3", userSelect: "none", WebkitUserSelect: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: "#fff", borderBottom: "1px solid #F0EFEC" }}>
          {isReview ? (
            <div style={{ padding: "12px 16px", textAlign: "center" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {winnerColor && <div style={{ width: 14, height: 14, borderRadius: "50%", background: winnerColor.fill }} />}
                <span style={{ fontSize: 17, fontWeight: 700 }}>{isDraw ? "It's a draw!" : `${winnerColor.name} wins!`}</span>
              </div>
              {!isDraw && <p style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Completed {config.linesNeeded} line{config.linesNeeded > 1 ? "s" : ""} of {config.lineLen}</p>}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 10 }}>
              <button onClick={() => setScreen("setup")} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: "#999" }}>←</button>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: playerColor.fill, boxShadow: `0 0 0 3px ${playerColor.light}` }} />
              <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{playerColor.name}'s turn</span>
              <span style={{ fontSize: 12, color: "#999" }}>Turn {turn}</span>
              {history.length > 0 && !pwr.firstDone && (
                <button onClick={undo} style={{ background: "none", border: "1.5px solid #E5E4E0", borderRadius: 8, fontSize: 13, cursor: "pointer", padding: "4px 10px", color: "#666", fontFamily: "inherit" }}>Undo</button>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 2, padding: "0 16px 8px" }}>
            {Array.from({ length: config.playerCount }).map((_, i) => (
              <div key={i} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 6,
                padding: "5px 10px", borderRadius: 8, transition: "background 0.2s",
                background: (isReview ? i === winner : i === cp) ? PLAYERS[i].light : "#FAFAF8",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: PLAYERS[i].fill }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: (isReview ? i === winner : i === cp) ? PLAYERS[i].fill : "#888" }}>
                  {scores[i] || 0}/{config.linesNeeded}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Zoom controls */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "6px 16px", background: "#F7F6F3" }}>
          <button onClick={() => setZoom(z => Math.max(20, z - 6))} style={{ width: 30, height: 30, borderRadius: 8, border: "1.5px solid #E5E4E0", background: "#fff", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>−</button>
          <button onClick={() => setZoom(z => Math.min(72, z + 6))} style={{ width: 30, height: 30, borderRadius: 8, border: "1.5px solid #E5E4E0", background: "#fff", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>+</button>
        </div>

        {/* Toast */}
        {msg && (
          <div style={{
            position: "fixed", top: 110, left: "50%", transform: "translateX(-50%)",
            background: "#1a1a1a", color: "#fff", padding: "8px 18px", borderRadius: 10,
            fontSize: 13, fontWeight: 500, zIndex: 50, animation: "fadeIn 0.2s",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)", whiteSpace: "nowrap",
          }}>{msg}</div>
        )}

        {/* Board */}
        <Board board={board} onCellClick={handleClick} lastMove={lastMove} winCells={winCells}
          currentPlayer={cp} actionMode={pwr.active && pwr.firstDone ? power?.id : null} zoom={zoom} onZoom={setZoom} ghostOwner={cp} />

        {/* Bottom bar */}
        {isReview ? (
          <div style={{ display: "flex", gap: 10, padding: "10px 16px", background: "#fff", borderTop: "1px solid #F0EFEC" }}>
            <button onClick={() => setScreen("setup")} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#F0EFEC", color: "#1a1a1a", fontFamily: "inherit" }}>Setup</button>
            <button onClick={() => startGame(config)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#1a1a1a", color: "#fff", fontFamily: "inherit" }}>Play Again</button>
          </div>
        ) : isPow && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#fff", borderTop: "1px solid #F0EFEC" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ opacity: 0.4 }}>{power.icon}</span> {power.name}
                {isDouble && <span style={{ fontSize: 11, background: "#E8EFFE", color: "#4A7BF7", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>×2 this turn</span>}
                {pwr.firstDone && power.id === "doublePlace" && <span style={{ fontSize: 11, background: "#FDE8E7", color: "#F25C54", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>2nd tile</span>}
                {pwr.firstDone && power.id !== "doublePlace" && <span style={{ fontSize: 11, background: "#E8EFFE", color: "#4A7BF7", padding: "2px 8px", borderRadius: 6, fontWeight: 500 }}>use power</span>}
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                {cd > 0 ? `Cooldown: ${cd} turn${cd > 1 ? "s" : ""}` : power.desc}
              </div>
            </div>
            {power.id !== "doublePlace" && !pwr.firstDone && (
              <button onClick={togglePower} disabled={!canUse && !pwr.active} style={{
                padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600,
                fontFamily: "inherit", cursor: (canUse || pwr.active) ? "pointer" : "default",
                transition: "all 0.15s",
                background: pwr.active ? "#F25C54" : canUse ? playerColor.fill : "#E5E4E0",
                color: (canUse || pwr.active) ? "#fff" : "#bbb",
              }}>{pwr.active ? "Cancel" : "Use"}</button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
