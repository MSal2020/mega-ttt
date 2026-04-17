// Pure game logic — shared between client (React) and server (PartyKit)
// No React or DOM dependencies

export const PLAYERS = [
  { fill: "#4A7BF7", light: "#E8EFFE", name: "Blue", ring: "#a4bcfb" },
  { fill: "#F25C54", light: "#FDE8E7", name: "Coral", ring: "#f9a8a5" },
  { fill: "#4DAA6D", light: "#E3F3E8", name: "Sage", ring: "#96d4a9" },
  { fill: "#F2A93B", light: "#FDF1DC", name: "Amber", ring: "#f7cf8a" },
];

export const POWERS = [
  { id: "doublePlace", name: "Double Place", desc: "Place 2 tiles every 3rd turn", cd: 0, icon: "◇" },
  { id: "takeover", name: "Takeover", desc: "Steal an opponent's tile (cd scales with grid)", cd: 3, icon: "△" },
  { id: "block", name: "Block", desc: "Deny an area for 3 turns (no one places)", cd: 2, icon: "□" },
  { id: "teleport", name: "Teleport", desc: "Move one of your tiles to an empty cell", cd: 3, icon: "◎" },
];

// Takeover cooldown scales by grid size (tile-centric impact)
export function getTakeoverCd(gridSize) {
  if (gridSize <= 9) return 4;
  if (gridSize <= 14) return 3;
  return 2;
}

// Block area size scales by lineLen (line-centric denial)
export function getBlockSize(lineLen) {
  if (lineLen <= 4) return 2;
  if (lineLen <= 6) return 3;
  return 4;
}

// Return the effective cooldown for a power in the given config.
// Powers use a fixed cd on their definition, except Takeover which scales with gridSize.
export function getPowerCd(powerId, gridSize) {
  if (powerId === "takeover") return getTakeoverCd(gridSize);
  const p = POWERS.find(p => p.id === powerId);
  return p ? p.cd : 0;
}

// Is the cell (r, c) inside any currently active block?
// blocks: [{ r, c, size, expiresAt, owner }]  — expiresAt is a globalTurn value
export function isBlocked(blocks, r, c, globalTurn) {
  if (!blocks || blocks.length === 0) return false;
  for (const b of blocks) {
    if (globalTurn >= b.expiresAt) continue;
    if (r >= b.r && r < b.r + b.size && c >= b.c && c < b.c + b.size) return true;
  }
  return false;
}

// Drop expired blocks (helper — caller usually filters on read too)
export function pruneBlocks(blocks, globalTurn) {
  return (blocks || []).filter(b => globalTurn < b.expiresAt);
}

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

// findLines: if pidOrSet is a Set, any owner in the set counts (team lines).
// Only maximal straight runs are returned (one entry per contiguous segment), so
// a line of 5 does not produce multiple overlapping 4-window lines.
export function findLines(board, pidOrSet, len) {
  const n = board.length, dirs = [[0,1],[1,0],[1,1],[1,-1]], found = [];
  const isSet = pidOrSet instanceof Set;
  const match = (owner) => isSet ? pidOrSet.has(owner) : owner === pidOrSet;
  const cellMatches = (cell) =>
    cell && match(cell.owner) && !cell.wall && cell.visible !== false && !cell.scored;
  for (const [dr, dc] of dirs) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const pr = r - dr, pc = c - dc;
      if (pr >= 0 && pr < n && pc >= 0 && pc < n && cellMatches(board[pr][pc])) continue;
      const cells = [];
      for (let i = 0; ; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
        const cell = board[nr][nc];
        if (cellMatches(cell)) cells.push([nr, nc]);
        else break;
      }
      if (cells.length >= len) found.push(cells);
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

// scoreAndMark: optional `teams` array of owner-id arrays; if present,
// lines are credited to each team member equally (team score = sum, visible to all).
// If a run is longer than lineLen, returns `pending` so the player can choose which
// contiguous segment counts (UI calls applyPendingLineScore with a start offset).
export function scoreAndMark(board, pc, lineLen, prevScores, teams = null) {
  const s = {};
  for (let p = 0; p < pc; p++) s[p] = (prevScores[p] || 0);
  const groups = teams && teams.length
    ? teams.map(team => ({ ids: team, set: new Set(team) }))
    : Array.from({ length: pc }, (_, p) => ({ ids: [p], set: null }));
  let found = true;
  while (found) {
    found = false;
    for (const g of groups) {
      const key = g.set || g.ids[0];
      const lines = findLines(board, key, lineLen);
      if (lines.length > 0) {
        const seg = lines[0];
        if (seg.length > lineLen) {
          return { scores: s, pending: { playerIds: g.ids, cells: seg } };
        }
        for (const mid of g.ids) s[mid] = (s[mid] || 0) + 1;
        for (const [r, c] of seg) {
          board[r][c] = { ...board[r][c], scored: true, anim: "score" };
        }
        found = true;
        break;
      }
    }
  }
  return { scores: s, pending: null };
}

/** Apply one chosen contiguous window from a pending overlong line, then resolve any further lines. */
export function applyPendingLineScore(board, pc, lineLen, pending, startIndex, prevScores, teams = null) {
  const seg = pending.cells;
  if (startIndex < 0 || startIndex + lineLen > seg.length) {
    const s = {};
    for (let p = 0; p < pc; p++) s[p] = (prevScores[p] || 0);
    return { scores: s, pending: null };
  }
  const s = {};
  for (let p = 0; p < pc; p++) s[p] = (prevScores[p] || 0);
  for (const mid of pending.playerIds) s[mid] = (s[mid] || 0) + 1;
  for (const [r, c] of seg.slice(startIndex, startIndex + lineLen)) {
    board[r][c] = { ...board[r][c], scored: true, anim: "score" };
  }
  return scoreAndMark(board, pc, lineLen, s, teams);
}

/** Player slot that may choose the segment (team: any member of the scoring group). */
export function canPickLineSlot(pending, slot) {
  return pending.playerIds.includes(slot);
}

export function aiPickMove(board, aiPlayer, lineLen, playerCount, blocks = [], globalTurn = 1) {
  const n = board.length;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  const empty = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (board[r][c]) continue;
    if (isBlocked(blocks, r, c, globalTurn)) continue;
    empty.push([r,c]);
  }
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

function getEmptyCells(board, blocks = [], globalTurn = 1) {
  const n = board.length;
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (board[r][c]) continue;
    if (isBlocked(blocks, r, c, globalTurn)) continue;
    cells.push([r, c]);
  }
  return cells;
}

function wouldCompleteLineAt(board, r, c, owner, lineLen) {
  const n = board.length;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let run = 1;
    for (let i = 1; i < lineLen; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
      const cell = board[nr][nc];
      if (cell && cell.owner === owner && !cell.wall && cell.visible !== false && !cell.scored) run++;
      else break;
    }
    for (let i = 1; i < lineLen; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
      const cell = board[nr][nc];
      if (cell && cell.owner === owner && !cell.wall && cell.visible !== false && !cell.scored) run++;
      else break;
    }
    if (run >= lineLen) return true;
  }
  return false;
}

function hardCandidateScore(board, r, c, aiPlayer, lineLen, playerCount) {
  let score = cellThreatScore(board, r, c, aiPlayer, lineLen, true) * 1.15;
  let oppMax = 0;
  for (let p = 0; p < playerCount; p++) {
    if (p === aiPlayer) continue;
    oppMax = Math.max(oppMax, cellThreatScore(board, r, c, p, lineLen, false));
  }
  score += oppMax * 0.95;
  const n = board.length;
  const cx = (n - 1) / 2, cy = (n - 1) / 2;
  score += Math.max(0, 4 - Math.abs(r - cx) - Math.abs(c - cy));
  return score;
}

// Hard mode: tactical checks (win/block) + shallow lookahead against best opponent reply.
export function aiPickMoveHard(board, aiPlayer, lineLen, playerCount, blocks = [], globalTurn = 1) {
  const empty = getEmptyCells(board, blocks, globalTurn);
  if (empty.length === 0) return null;

  const opponentIds = [];
  for (let p = 0; p < playerCount; p++) if (p !== aiPlayer) opponentIds.push(p);

  // 1) Take immediate winning move.
  const winning = empty.filter(([r, c]) => wouldCompleteLineAt(board, r, c, aiPlayer, lineLen));
  if (winning.length) {
    winning.sort((a, b) => hardCandidateScore(board, b[0], b[1], aiPlayer, lineLen, playerCount) - hardCandidateScore(board, a[0], a[1], aiPlayer, lineLen, playerCount));
    return winning[0];
  }

  // 2) Block immediate opponent win if present.
  const forcedBlocks = empty.filter(([r, c]) => opponentIds.some(opp => wouldCompleteLineAt(board, r, c, opp, lineLen)));
  if (forcedBlocks.length) {
    forcedBlocks.sort((a, b) => hardCandidateScore(board, b[0], b[1], aiPlayer, lineLen, playerCount) - hardCandidateScore(board, a[0], a[1], aiPlayer, lineLen, playerCount));
    return forcedBlocks[0];
  }

  // 3) Shallow lookahead: score our move, then subtract strongest opponent reply.
  const candidates = empty
    .map(([r, c]) => ({ r, c, base: hardCandidateScore(board, r, c, aiPlayer, lineLen, playerCount) }))
    .sort((a, b) => b.base - a.base)
    .slice(0, Math.min(14, empty.length));

  let best = -Infinity;
  let bestMove = null;
  for (const cand of candidates) {
    const sim = cloneBoard(board);
    sim[cand.r][cand.c] = { owner: aiPlayer, visible: true };

    let oppBest = 0;
    const oppMoves = getEmptyCells(sim, blocks, globalTurn)
      .map(([or, oc]) => {
        let score = 0;
        for (const opp of opponentIds) {
          if (wouldCompleteLineAt(sim, or, oc, opp, lineLen)) score = Math.max(score, 12000);
          score = Math.max(score, cellThreatScore(sim, or, oc, opp, lineLen, true));
        }
        return { or, oc, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    for (const om of oppMoves) oppBest = Math.max(oppBest, om.score);

    const total = cand.base * 1.2 - oppBest * 1.05 + Math.random() * 0.25;
    if (total > best) {
      best = total;
      bestMove = [cand.r, cand.c];
    }
  }

  return bestMove || [candidates[0].r, candidates[0].c];
}

// Score a cell for a given owner based on how much it extends/blocks lines.
// Used by the AI heuristics.
function cellThreatScore(board, r, c, owner, lineLen, asOwner) {
  const n = board.length;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  let score = 0;
  for (const [dr, dc] of dirs) {
    let fwd = 0, bwd = 0, fwdOpen = 0, bwdOpen = 0;
    for (let i = 1; i < lineLen; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
      const cell = board[nr][nc];
      if (cell && cell.owner === owner && !cell.wall && cell.visible !== false && !cell.scored) fwd++;
      else { if (!cell) fwdOpen = 1; break; }
    }
    for (let i = 1; i < lineLen; i++) {
      const nr = r - dr * i, nc = c - dc * i;
      if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
      const cell = board[nr][nc];
      if (cell && cell.owner === owner && !cell.wall && cell.visible !== false && !cell.scored) bwd++;
      else { if (!cell) bwdOpen = 1; break; }
    }
    const run = fwd + bwd;
    const openEnds = fwdOpen + bwdOpen;
    if (run + 1 >= lineLen) score += asOwner ? 10000 : 8000;
    else if (run + 1 === lineLen - 1 && openEnds >= 1) score += asOwner ? 500 : 600;
    else if (run >= 2) score += run * 30 + openEnds * 12;
    else if (run >= 1) score += 4;
  }
  return score;
}

// Pick the best cell for a power action.
// powerId: "takeover" | "block" | "teleport"
// For "block", returns the top-left anchor of a size×size area.
// For "teleport", returns { from: [r,c], to: [r,c] }.
export function aiPickPowerAction(board, aiPlayer, powerId, lineLen, playerCount, blocks = [], globalTurn = 1) {
  const n = board.length;
  if (powerId === "takeover") {
    let best = -Infinity, bestCell = null;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (!cell || cell.wall || cell.owner === aiPlayer || cell.visible === false || cell.scored) continue;
      const temp = { ...cell };
      board[r][c] = null;
      const oppScore = cellThreatScore(board, r, c, cell.owner, lineLen, true);
      board[r][c] = temp;
      const score = oppScore + Math.random() * 5;
      if (score > best) { best = score; bestCell = [r, c]; }
    }
    return bestCell;
  }
  if (powerId === "block") {
    // Pick anchor for a size×size area that covers the highest aggregate opp threat.
    const size = getBlockSize(lineLen);
    let best = -Infinity, bestAnchor = null;
    for (let r = 0; r <= n - size; r++) for (let c = 0; c <= n - size; c++) {
      let areaScore = 0;
      let emptyInArea = 0;
      for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
        const rr = r + dr, cc = c + dc;
        if (isBlocked(blocks, rr, cc, globalTurn)) { areaScore = -Infinity; break; }
        if (!board[rr][cc]) {
          emptyInArea++;
          let oppMax = 0;
          for (let p = 0; p < playerCount; p++) {
            if (p === aiPlayer) continue;
            oppMax = Math.max(oppMax, cellThreatScore(board, rr, cc, p, lineLen, false));
          }
          areaScore += oppMax;
        }
      }
      if (areaScore === -Infinity) continue;
      // Prefer areas with more empty cells (more denial value)
      areaScore += emptyInArea * 2 + Math.random() * 5;
      if (areaScore > best) { best = areaScore; bestAnchor = [r, c]; }
    }
    return bestAnchor;
  }
  if (powerId === "teleport") {
    // Pick the move that maximizes: gain at destination - value at current source.
    let best = -Infinity, bestMove = null;
    // Candidate sources: AI's own tiles (not scored, not wall)
    const sources = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const cell = board[r][c];
      if (cell && cell.owner === aiPlayer && !cell.wall && !cell.scored && cell.visible !== false) {
        if (!isBlocked(blocks, r, c, globalTurn)) sources.push([r, c]);
      }
    }
    if (sources.length === 0) return null;
    // Candidate destinations: empty, non-blocked cells
    const dests = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!board[r][c] && !isBlocked(blocks, r, c, globalTurn)) dests.push([r, c]);
    }
    if (dests.length === 0) return null;
    for (const [sr, sc] of sources) {
      const srcVal = cellThreatScore(board, sr, sc, aiPlayer, lineLen, true);
      const temp = board[sr][sc];
      board[sr][sc] = null;
      for (const [dr, dc] of dests) {
        const destVal = cellThreatScore(board, dr, dc, aiPlayer, lineLen, true);
        const score = destVal - srcVal * 0.6 + Math.random() * 4;
        if (score > best) { best = score; bestMove = { from: [sr, sc], to: [dr, dc] }; }
      }
      board[sr][sc] = temp;
    }
    return bestMove;
  }
  return null;
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
