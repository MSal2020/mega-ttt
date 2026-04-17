import { makeBoard, aiPlanPowerAction, getPowerCd, getBlockSize, aiPickMoveHard } from "../lib/gameLogic.js";

function rng(seed = 42) {
  let s = seed >>> 0;
  return () => (s = (1664525 * s + 1013904223) >>> 0) / 4294967296;
}

const rand = rng(1337);

function isBlocked(blocks, r, c, gt) {
  for (const b of blocks) {
    if (gt >= b.expiresAt) continue;
    if (r >= b.r && r < b.r + b.size && c >= b.c && c < b.c + b.size) return true;
  }
  return false;
}

function cellThreatScore(board, r, c, owner, lineLen, asOwner) {
  const n = board.length;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
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

function bestExtraPlacementScore(board, aiPlayer, lineLen, blocks, gt) {
  let best = -Infinity;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board.length; c++) {
      if (board[r][c]) continue;
      if (isBlocked(blocks, r, c, gt)) continue;
      best = Math.max(best, cellThreatScore(board, r, c, aiPlayer, lineLen, true));
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function randomState(n = 12, playerCount = 2, fill = 0.28, lineLen = 5) {
  const board = makeBoard(n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (rand() < fill) {
        board[r][c] = { owner: Math.floor(rand() * playerCount), visible: true, scored: false };
      }
    }
  }
  const blocks = [];
  if (rand() < 0.4) {
    const size = getBlockSize(lineLen);
    const count = rand() < 0.5 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const rr = Math.floor(rand() * Math.max(1, n - size + 1));
      const cc = Math.floor(rand() * Math.max(1, n - size + 1));
      blocks.push({ r: rr, c: cc, size, expiresAt: 999, owner: 1 });
    }
  }
  return { board, blocks };
}

function playoutState(n = 12, playerCount = 2, fill = 0.28, lineLen = 5) {
  const board = makeBoard(n);
  const total = n * n;
  const targetMoves = Math.max(1, Math.floor(total * fill));
  let turn = 0;
  for (let i = 0; i < targetMoves; i++) {
    const p = turn % playerCount;
    let move = aiPickMoveHard(board, p, lineLen, playerCount, [], 1);
    if (!move) {
      // Fallback to first available empty cell.
      let found = null;
      for (let r = 0; r < n && !found; r++) {
        for (let c = 0; c < n; c++) {
          if (!board[r][c]) { found = [r, c]; break; }
        }
      }
      move = found;
    }
    if (!move) break;
    const [r, c] = move;
    if (!board[r][c]) board[r][c] = { owner: p, visible: true, scored: false };
    turn++;
  }
  const blocks = [];
  if (rand() < 0.25) {
    const size = getBlockSize(lineLen);
    const rr = Math.floor(rand() * Math.max(1, n - size + 1));
    const cc = Math.floor(rand() * Math.max(1, n - size + 1));
    blocks.push({ r: rr, c: cc, size, expiresAt: 999, owner: (turn + 1) % playerCount });
  }
  return { board, blocks };
}

function avg(arr) {
  return arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : 0;
}

function analyze({ n = 12, playerCount = 2, lineLen = 5, samples = 3000, fill = 0.28, mode = "random" }) {
  const ai = 1;
  const gt = 1;
  const takeScores = [];
  const tpScores = [];
  const blockScores = [];
  const dpScores = [];
  let takeAvail = 0;
  let tpAvail = 0;
  let blockAvail = 0;

  for (let i = 0; i < samples; i++) {
    const { board, blocks } = mode === "playout"
      ? playoutState(n, playerCount, fill, lineLen)
      : randomState(n, playerCount, fill, lineLen);
    const t = aiPlanPowerAction(board, ai, "takeover", lineLen, playerCount, blocks, gt);
    const p = aiPlanPowerAction(board, ai, "teleport", lineLen, playerCount, blocks, gt);
    const b = aiPlanPowerAction(board, ai, "block", lineLen, playerCount, blocks, gt);
    if (t?.score != null) { takeScores.push(t.score); takeAvail++; }
    if (p?.score != null) { tpScores.push(p.score); tpAvail++; }
    if (b?.score != null) { blockScores.push(b.score); blockAvail++; }
    dpScores.push(bestExtraPlacementScore(board, ai, lineLen, blocks, gt));
  }

  const cdTake = getPowerCd("takeover", n);
  const cdTp = getPowerCd("teleport", n);
  const cdBlock = getPowerCd("block", n);
  const cycle = (cd) => cd + 1;

  const activation = {
    takeover: avg(takeScores),
    teleport: avg(tpScores),
    block: avg(blockScores),
    doublePlace: avg(dpScores),
  };

  const perTurn = {
    takeover: activation.takeover / cycle(cdTake),
    teleport: activation.teleport / cycle(cdTp),
    block: activation.block / cycle(cdBlock),
    doublePlace: activation.doublePlace / 3,
  };

  const availability = {
    takeover: takeAvail / samples,
    teleport: tpAvail / samples,
    block: blockAvail / samples,
  };

  const effectivePerTurn = {
    takeover: perTurn.takeover * availability.takeover,
    teleport: perTurn.teleport * availability.teleport,
    block: perTurn.block * availability.block,
    doublePlace: perTurn.doublePlace,
  };

  return {
    config: { n, playerCount, lineLen, samples, fill, mode },
    cooldowns: { takeover: cdTake, teleport: cdTp, block: cdBlock },
    availability,
    activation,
    perTurn,
    effectivePerTurn,
  };
}

for (const cfg of [
  { n: 12, lineLen: 5, samples: 500 },
]) {
  for (const playerCount of [2]) {
    for (const fill of [0.28, 0.45]) {
      for (const mode of ["random", "playout"]) {
        const out = analyze({ ...cfg, playerCount, fill, mode });
        console.log("---");
        console.log(JSON.stringify(out, null, 2));
      }
    }
  }
}
