// Pure game logic — shared between client (React) and server (PartyKit)
// No React or DOM dependencies

export const PLAYERS = [
  { fill: "#4A7BF7", light: "#E8EFFE", name: "Blue", ring: "#a4bcfb" },
  { fill: "#F25C54", light: "#FDE8E7", name: "Coral", ring: "#f9a8a5" },
  { fill: "#4DAA6D", light: "#E3F3E8", name: "Sage", ring: "#96d4a9" },
  { fill: "#F2A93B", light: "#FDF1DC", name: "Amber", ring: "#f7cf8a" },
];

export const POWERS = [
  { id: "doublePlace", name: "Double Place", desc: "2 tiles every other turn", cd: 0, icon: "◇" },
  { id: "takeover", name: "Takeover", desc: "Steal an opponent's tile", cd: 3, icon: "△" },
  { id: "block", name: "Block", desc: "Drop a permanent wall", cd: 3, icon: "□" },
  { id: "ghost", name: "Ghost", desc: "Place a hidden tile", cd: 0, icon: "○" },
];

export function getWinConditions(gs, pc) {
  if (gs <= 9) return { lineLen: 4, linesNeeded: pc <= 3 ? 2 : 1 };
  if (gs <= 14) return { lineLen: 5, linesNeeded: pc <= 3 ? 2 : 1 };
  return { lineLen: 5, linesNeeded: pc <= 3 ? 3 : 2 };
}

export function makeBoard(n) {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => null));
}

export function cloneBoard(board) {
  return board.map(row => row.map(c => c ? { ...c } : null));
}

export function findLines(board, pid, len) {
  const n = board.length, dirs = [[0,1],[1,0],[1,1],[1,-1]], found = [];
  const used = new Set();
  for (const [dr,dc] of dirs) {
    const dirKey = `${dr},${dc}`;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (used.has(`${dirKey},${r},${c}`)) continue;
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

export function revealGhosts(board, gTurn) {
  return board.map(row => row.map(c => {
    if (c && c.visible === false && gTurn - c.placedTurn >= 2) return { ...c, visible: true, anim: "reveal" };
    return c ? { ...c } : null;
  }));
}

export function scoreAndMark(board, pc, lineLen, prevScores) {
  const s = {};
  for (let p = 0; p < pc; p++) s[p] = (prevScores[p] || 0);
  let found = true;
  while (found) {
    found = false;
    for (let p = 0; p < pc; p++) {
      const lines = findLines(board, p, lineLen);
      if (lines.length > 0) {
        s[p]++;
        for (const [r,c] of lines[0]) {
          board[r][c] = { ...board[r][c], scored: true, anim: "score" };
        }
        found = true;
        break;
      }
    }
  }
  return s;
}

export function aiPickMove(board, aiPlayer, lineLen, playerCount) {
  const n = board.length;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const empty = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!board[r][c]) empty.push([r,c]);
  if (empty.length === 0) return null;

  let best = -Infinity, bestMoves = [];
  for (const [r,c] of empty) {
    let score = 0;
    for (const [dr,dc] of dirs) {
      for (let pid = 0; pid < playerCount; pid++) {
        let fwd = 0, bwd = 0, fwdOpen = 0, bwdOpen = 0;
        for (let i = 1; i < lineLen; i++) {
          const nr = r+dr*i, nc = c+dc*i;
          if (nr<0||nr>=n||nc<0||nc>=n) break;
          const cell = board[nr][nc];
          if (cell && cell.owner === pid && !cell.wall && cell.visible !== false && !cell.scored) fwd++;
          else { if (!cell) fwdOpen = 1; break; }
        }
        for (let i = 1; i < lineLen; i++) {
          const nr = r-dr*i, nc = c-dc*i;
          if (nr<0||nr>=n||nc<0||nc>=n) break;
          const cell = board[nr][nc];
          if (cell && cell.owner === pid && !cell.wall && cell.visible !== false && !cell.scored) bwd++;
          else { if (!cell) bwdOpen = 1; break; }
        }
        const run = fwd + bwd;
        const openEnds = fwdOpen + bwdOpen;
        if (run + 1 >= lineLen) {
          score += pid === aiPlayer ? 10000 : 5000;
        } else if (run + 1 === lineLen - 1 && openEnds >= 1) {
          score += pid === aiPlayer ? 500 : 300;
        } else if (run >= 2) {
          score += pid === aiPlayer ? (run * 20 + openEnds * 10) : (run * 15 + openEnds * 8);
        } else if (run >= 1) {
          score += pid === aiPlayer ? 5 : 3;
        }
      }
    }
    const cx = (n-1)/2, cy = (n-1)/2;
    score += Math.max(0, 3 - Math.abs(r-cx) - Math.abs(c-cy)) * 0.5;
    score += Math.random() * 2;

    if (score > best) { best = score; bestMoves = [[r,c]]; }
    else if (score === best) bestMoves.push([r,c]);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

/** Check if board is full */
export function isBoardFull(board) {
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[0].length; c++)
      if (!board[r][c]) return false;
  return true;
}

/** Get all scored cells for a player */
export function getScoredCells(board, player) {
  const cells = [];
  for (let r = 0; r < board.length; r++)
    for (let c = 0; c < board[r].length; c++)
      if (board[r][c]?.owner === player && board[r][c]?.scored) cells.push([r, c]);
  return cells;
}

/** Generate a random room code (4 uppercase alphanumeric chars) */
export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
