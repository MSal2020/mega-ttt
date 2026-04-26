import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  PLAYERS, POWERS, getWinConditions, makeBoard, cloneBoard,
  revealGhosts, scoreAndMark, applyPendingLineScore, aiPickMove, aiPickMoveHard, aiPickPowerAction, aiPlanPowerAction,
  canPickLineSlot,
  isBoardFull, getScoredCells, generateRoomCode,
  getBlockSize, getPowerCd, isBlocked, pruneBlocks,
} from "../lib/gameLogic.js";
import { createConnection } from "./multiplayer.js";
import { sfx, haptic } from "./sounds.js";
import { recordGame } from "./stats.js";
import { THEMES, ThemeCtx, useTheme, themeVars } from "./theme.js";
import { css } from "./styles.js";
import { PlayerMark, ReconnectBanner, Confetti, RollingNumber, Collapse } from "./widgets.jsx";
import { StatsScreen, SettingsScreen } from "./screens.jsx";
import { Setup } from "./Setup.jsx";
import { Board } from "./Board.jsx";
import { OnlineLobby } from "./OnlineLobby.jsx";

/** Resolve scoring for AI: always uses the first valid segment on overlong lines. */
function flushScorePending(b, playerCount, lineLen, scoresIn, teams) {
  let r = scoreAndMark(b, playerCount, lineLen, scoresIn, teams);
  while (r.pending) {
    r = applyPendingLineScore(b, playerCount, lineLen, r.pending, 0, r.scores, teams);
  }
  return r.scores;
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
  // Latest server snapshot — used to push the pre-move state to `history`
  // so the review scrubber works for online games (matches local-game flow).
  const onlineSnapshotRef = useRef(null);
  /** Longer-than-needed line: player must pick a contiguous segment (sync with server `pendingLinePick`). */
  const [pendingLinePick, setPendingLinePick] = useState(null);

  const toastTimeoutRef = useRef(null);
  const toast = useCallback((t) => {
    setMsg(t);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => { setMsg(null); toastTimeoutRef.current = null; }, 1600);
  }, []);

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

    // Refresh the snapshot ref so the next move-applied can push the prior
    // state into review history.
    const prev = onlineSnapshotRef.current;
    onlineSnapshotRef.current = {
      board: msg.board ? cloneBoard(msg.board) : prev?.board,
      cp: msg.cp ?? prev?.cp ?? 0,
      turn: msg.turn ?? prev?.turn ?? 1,
      globalTurn: msg.globalTurn ?? prev?.globalTurn ?? 1,
      scores: msg.scores ? { ...msg.scores } : (prev?.scores || {}),
      cooldowns: msg.cooldowns ? { ...msg.cooldowns } : (prev?.cooldowns || {}),
      playerTurns: msg.playerTurns ? { ...msg.playerTurns } : (prev?.playerTurns || {}),
      lastMove: msg.lastMove !== undefined ? msg.lastMove : prev?.lastMove,
    };

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
      // Push the prior snapshot to review history *before* applying the new
      // server state. Mirrors the per-move history we keep for local games so
      // the replay scrubber works in online review too.
      if (msg.type === "move-applied") {
        const prior = onlineSnapshotRef.current;
        if (prior?.board) {
          setHistory(h => [...h, {
            board: prior.board,
            cp: prior.cp,
            turn: prior.turn,
            globalTurn: prior.globalTurn,
            scores: prior.scores,
            cooldowns: prior.cooldowns,
            playerTurns: prior.playerTurns,
            lastMove: prior.lastMove,
          }]);
        }
      }
      if (msg.type === "game-started") {
        // Fresh game (or rematch) — clear any prior review history.
        setHistory([]);
        setReplayIdx(null);
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
  if (screen === "stats") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><StatsScreen onBack={() => setScreen("setup")} /></ThemeCtx.Provider>;
  if (screen === "settings") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><SettingsScreen onBack={() => setScreen("setup")} onReplayTutorial={() => { try { localStorage.removeItem("mtt-tutorial-seen"); } catch {} setScreen("setup"); }} dark={dark} setDark={setDark} /></ThemeCtx.Provider>;
  if (screen === "online-lobby") return <ThemeCtx.Provider value={theme}><style>{themedCss}</style><OnlineLobby onBack={() => { if (onlineConn) { onlineConn.close(); setOnlineConn(null); } try { const u = new URL(window.location.href); u.searchParams.delete("room"); window.history.replaceState({}, "", u.toString()); } catch {} setScreen("setup"); }} onGameStart={handleOnlineGameStart} /></ThemeCtx.Provider>;

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
            {(!isOnline || onlineSlot >= 0) && (
              <button className="btn-hover" disabled={isOnline && rematchVote.votedSlots.includes(onlineSlot)} onClick={() => isOnline && onlineConnRef.current ? onlineConnRef.current.rematch() : startGame(config)} style={{
                flex: 1, padding: 12, borderRadius: 12,
                border: `0.5px solid ${theme.ink}`,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                background: theme.ink, color: theme.mode === "dark" ? theme.bg1 : "#FAF7F0",
                boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                fontFamily: "inherit", opacity: isOnline && rematchVote.votedSlots.includes(onlineSlot) ? 0.6 : 1,
              }}>{isOnline ? (rematchVote.votedSlots.includes(onlineSlot) ? `Waiting ${rematchVote.count}/${rematchVote.needed}` : (rematchVote.needed > 0 ? `Rematch ${rematchVote.count}/${rematchVote.needed}` : "Rematch")) : "Play Again"}</button>
            )}
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
