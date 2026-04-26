import { useState, useEffect, useRef, useCallback } from "react";
import { PLAYERS, TEAM_ACCENTS, teamOf, isBlocked } from "../lib/gameLogic.js";
import { useTheme } from "./theme.js";
import { PlayerMark } from "./widgets.jsx";

export function Board({ board, onCellClick, lastMove, lastMoves = [], winCells, currentPlayer, actionMode, zoom, onZoom, ghostOwner, blocks = [], globalTurn = 1, tpSource = null, cursor = null, linePickCells = null, teams = false }) {
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
        const rect = el.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
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
        const newScrollLeft = pinchRef.current.boardX * ratio - pinchRef.current.mx;
        const newScrollTop = pinchRef.current.boardY * ratio - pinchRef.current.my;
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

  const winSet = new Set(winCells.map(([r, c]) => `${r},${c}`));
  const linePickSet = linePickCells ? new Set(linePickCells.map(([r, c]) => `${r},${c}`)) : null;

  // Minimap
  const miniRef = useRef(null);
  const [miniState, setMiniState] = useState({ show: false, sl: 0, st: 0, sw: 0, sh: 0, cw: 0, ch: 0 });
  const [miniCorner, setMiniCorner] = useState(() => {
    try { return localStorage.getItem("mtt-mini-corner") || "br"; } catch { return "br"; }
  });
  const [miniDrag, setMiniDrag] = useState(null);
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
      if (!moved) return;
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
          const tpSrcPick = actionMode === "teleport" && !tpSource && cell && cell.owner === currentPlayer && !cell.wall && !cell.scored && cell.visible !== false && !cellBlocked;
          const tpDstPick = actionMode === "teleport" && tpSource && !cell && !cellBlocked;
          const isTpSource = tpSource && tpSource[0] === r && tpSource[1] === c;
          const blockAnchorPick = actionMode === "block" && !cell;

          const clickable = (!cell && !actionMode && !cellBlocked) || stealTarget || blockAnchorPick || tpSrcPick || tpDstPick;

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
                  {teams && (
                    <div className="hover-dot" style={{
                      position: "absolute", inset: 1, borderRadius: 4,
                      boxShadow: `inset 0 0 0 1.5px ${TEAM_ACCENTS[teamOf(currentPlayer)]}`,
                      opacity: 0, transition: "opacity 0.18s", pointerEvents: "none",
                    }} />
                  )}
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
              {owned && teams && (
                <div style={{
                  position: "absolute", inset: 1, borderRadius: 4,
                  boxShadow: `inset 0 0 0 1.5px ${TEAM_ACCENTS[teamOf(cell.owner)]}`,
                  opacity: isScored ? 0.45 : 0.78,
                  pointerEvents: "none",
                }} />
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
