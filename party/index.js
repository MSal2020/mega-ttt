import {
  makeBoard, cloneBoard, scoreAndMark, applyPendingLineScore, revealGhosts,
  isBoardFull, getScoredCells, POWERS,
  getBlockSize, getPowerCd, isBlocked, pruneBlocks,
  canPickLineSlot,
} from "../lib/gameLogic.js";

/**
 * PartyKit server for Mega Tic Tac Toe online multiplayer.
 * Each room = one game session identified by a 4-char code.
 * Server-authoritative: validates every move, broadcasts state.
 */
export default class MegaTTTServer {
  constructor(room) {
    this.room = room;
    this.reset();
  }

  reset() {
    this.players = [];       // [{ id, name, slot }]
    this.phase = "lobby";    // lobby | playing | review
    this.rematchVotes = new Set(); // slots that have voted for rematch
    this.config = null;
    this.board = [];
    this.cp = 0;
    this.turn = 1;
    this.globalTurn = 1;
    this.scores = {};
    this.cooldowns = {};
    this.playerTurns = {};
    this.lastMove = null;
    this.winner = null;
    this.isDraw = false;
    this.winCells = [];
    this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
    this.blocks = [];
    this.timerInterval = null;
    this.timeLeft = 0;
    this.pendingLinePick = null; // { pending, resume, extra? }
  }

  onConnect(conn) {
    // Send current full state on connect/reconnect
    conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: this.getSlot(conn.id) }));
  }

  onClose(conn) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    // Mark disconnected but keep slot reserved so they can reclaim on reconnect
    player.disconnected = true;
    this.broadcast({ type: "player-left", slot: player.slot, name: player.name });
    if (this.phase === "playing" && !player.spectator) {
      this.stopTimer();
      this.broadcast({ type: "opponent-disconnected" });
    }
    this.publishListing();
    // Host migration: if host (slot 0) disconnects during lobby, promote
    // the lowest-slotted still-connected player to slot 0 so the room can proceed.
    if (this.phase === "lobby" && player.slot === 0) {
      const live = this.players.filter(p => !p.disconnected && !p.spectator).sort((a, b) => a.slot - b.slot);
      if (live.length > 0) {
        const newHost = live[0];
        // Drop the disconnected host entirely (no reclaim) — lobby only
        this.players = this.players.filter(p => p.id !== player.id);
        newHost.slot = 0;
        this.broadcast({ type: "host-migrated", newHostName: newHost.name, newHostSlot: 0 });
        // Push fresh state so each client updates its `you` slot
        for (const p of this.players) {
          const c = [...this.room.getConnections()].find(x => x.id === p.id);
          if (c) c.send(JSON.stringify({ type: "room-state", ...this.getState(), you: p.slot }));
        }
      }
    }
  }

  onMessage(msg, conn) {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    switch (data.type) {
      case "join": return this.handleJoin(conn, data);
      case "rename": return this.handleRename(conn, data);
      case "config": return this.handleConfig(conn, data);
      case "start": return this.handleStart(conn);
      case "move": return this.handleMove(conn, data);
      case "line-offset": return this.handleLineOffset(conn, data);
      case "power-toggle": return this.handlePowerToggle(conn);
      case "rematch": return this.handleRematch(conn);
      case "emote": return this.handleEmote(conn, data);
      default: break;
    }
  }

  handleEmote(conn, data) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    if (!data.emote || typeof data.emote !== "string" || data.emote.length > 16) return;
    this.broadcast({ type: "emote", slot: player.slot, name: player.name, emote: data.emote, at: Date.now() });
  }

  handleJoin(conn, data) {
    // Reclaim slot if a player with this id was previously here
    const existing = this.players.find(p => p.id === conn.id);
    if (existing) {
      existing.disconnected = false;
      conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: existing.slot }));
      if (existing.spectator) {
        this.broadcast({ type: "spectator-joined", name: existing.name });
      } else {
        this.broadcast({ type: "player-joined", slot: existing.slot, name: existing.name, playerCount: this.activePlayerCount() });
      }
      return;
    }
    // Cap = host's chosen playerCount (defaults to 4 before config is set)
    const cap = this.config?.playerCount || 4;
    const activeCount = this.players.filter(p => !p.disconnected && !p.spectator).length;
    if (activeCount >= cap) {
      // Join as spectator — receives state but cannot play
      const name = (data.name || "Spectator").slice(0, 20);
      this.players.push({ id: conn.id, name, slot: -1, disconnected: false, spectator: true });
      conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: -1, spectator: true }));
      this.broadcast({ type: "spectator-joined", name });
      return;
    }
    // Take the lowest free slot (handles freed/reordered slots)
    const takenSlots = new Set(this.players.filter(p => !p.disconnected && !p.spectator).map(p => p.slot));
    let slot = 0;
    while (takenSlots.has(slot)) slot++;
    const name = (data.name || `Player ${slot + 1}`).slice(0, 20);
    // Remove any stale disconnected entry occupying this slot
    this.players = this.players.filter(p => p.slot !== slot || !p.disconnected);
    this.players.push({ id: conn.id, name, slot, disconnected: false });

    conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: slot }));
    this.broadcast({ type: "player-joined", slot, name, playerCount: this.activePlayerCount() });
    this.publishListing();
  }

  handleRename(conn, data) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    const name = (data.name || "").slice(0, 20).trim();
    if (!name) return;
    player.name = name;
    if (player.spectator) {
      this.broadcast({ type: "spectator-renamed", name });
      return;
    }
    this.broadcast({ type: "player-joined", slot: player.slot, name, playerCount: this.activePlayerCount() });
  }

  activePlayerCount() {
    return this.players.filter(p => !p.disconnected && !p.spectator).length;
  }

  hasAllPlayersPresent() {
    if (!this.config?.playerCount) return false;
    return this.activePlayerCount() >= this.config.playerCount;
  }

  normalizeConfig(cfg) {
    if (!cfg || typeof cfg !== "object") return null;

    const mode = cfg.mode === "powers" ? "powers" : "normal";

    const gridSizeNum = Number(cfg.gridSize);
    if (!Number.isInteger(gridSizeNum) || gridSizeNum < 7 || gridSizeNum > 20) return null;

    const playerCountNum = Number(cfg.playerCount);
    if (!Number.isInteger(playerCountNum) || playerCountNum < 2 || playerCountNum > 4) return null;

    const maxLineLen = Math.min(gridSizeNum, 8);
    const lineLenNum = Number(cfg.lineLen);
    if (!Number.isInteger(lineLenNum) || lineLenNum < 3 || lineLenNum > maxLineLen) return null;

    const linesNeededNum = Number(cfg.linesNeeded);
    if (!Number.isInteger(linesNeededNum) || linesNeededNum < 1 || linesNeededNum > 5) return null;

    const powersIn = Array.isArray(cfg.powers) ? cfg.powers : [];
    const powers = powersIn.slice(0, playerCountNum).map((p) => Number(p));
    if (powers.length !== playerCountNum) return null;
    if (powers.some((p) => !Number.isInteger(p) || p < 0 || p >= POWERS.length)) return null;
    if (mode === "powers" && new Set(powers).size !== powers.length) return null;

    const timerNum = Number(cfg.timer);
    let timer = 0;
    if (Number.isFinite(timerNum) && timerNum > 0) {
      if (!Number.isInteger(timerNum) || timerNum < 5 || timerNum > 60) return null;
      timer = timerNum;
    }

    const teams = !!cfg.teams && playerCountNum === 4;
    const isPublic = !!cfg.public;

    return {
      mode,
      gridSize: gridSizeNum,
      playerCount: playerCountNum,
      powers,
      lineLen: lineLenNum,
      linesNeeded: linesNeededNum,
      timer,
      ai: false,
      teams,
      public: isPublic,
    };
  }

  handleConfig(conn, data) {
    if (this.getSlot(conn.id) !== 0) return; // only host
    if (this.phase !== "lobby") return;
    const normalized = this.normalizeConfig(data.config);
    if (!normalized) {
      conn.send(JSON.stringify({ type: "error", message: "Invalid game configuration" }));
      return;
    }
    if (normalized.playerCount < this.activePlayerCount()) {
      conn.send(JSON.stringify({ type: "error", message: "Player count can't be lower than seated players" }));
      return;
    }
    this.config = normalized;
    this.broadcast({ type: "config-updated", config: this.config });
    this.publishListing();
  }

  async publishListing() {
    const parties = this.room.context?.parties || this.room.parties;
    if (!parties?.lobby) return;
    const stub = parties.lobby.get("public");
    const host = this.players.find(p => p.slot === 0);
    const payload = {
      action: (this.config?.public && this.phase === "lobby") ? "set" : "remove",
      code: this.room.id,
      hostName: host?.name || "Host",
      players: this.activePlayerCount(),
      playerCount: this.config?.playerCount || 2,
      gridSize: this.config?.gridSize || 12,
      mode: this.config?.mode || "normal",
      teams: !!this.config?.teams,
    };
    try {
      await stub.fetch({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }

  handleStart(conn) {
    if (this.getSlot(conn.id) !== 0) return; // only host
    const need = this.config?.playerCount || 2;
    if (this.activePlayerCount() < need) {
      conn.send(JSON.stringify({ type: "error", message: `Need ${need} players` }));
      return;
    }
    if (!this.config) {
      conn.send(JSON.stringify({ type: "error", message: "Set config first" }));
      return;
    }

    // Initialize game
    this.phase = "playing";
    this.publishListing(); // remove from public list — no longer joinable as lobby
    this.board = makeBoard(this.config.gridSize);
    this.cp = 0;
    this.turn = 1;
    this.globalTurn = 1;
    this.scores = {};
    this.cooldowns = {};
    this.playerTurns = {};
    this.lastMove = null;
    this.winner = null;
    this.isDraw = false;
    this.winCells = [];
    this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
    this.blocks = [];
    this.timeLeft = this.config.timer || 0;
    this.pendingLinePick = null;

    this.broadcastState("game-started");
    this.startTimer();
  }

  teamsArg() {
    return this.config?.teams ? [[0, 2], [1, 3]] : null;
  }

  handleMove(conn, data) {
    if (this.phase !== "playing") return;
    if (!this.hasAllPlayersPresent()) {
      conn.send(JSON.stringify({ type: "error", message: "Waiting for all players to reconnect" }));
      return;
    }
    if (this.pendingLinePick) {
      conn.send(JSON.stringify({ type: "error", message: "Choose which line segment to score first" }));
      return;
    }
    const slot = this.getSlot(conn.id);
    if (slot === -1 || slot !== this.cp) return; // not your turn

    const { r, c } = data;
    if (r < 0 || r >= this.board.length || c < 0 || c >= this.board[0].length) return;

    const cell = this.board[r][c];
    const isPow = this.config.mode === "powers";
    const power = isPow ? POWERS[this.config.powers[this.cp]] : null;

    // Step 2: power action after normal tile
    if (this.pwr.active && this.pwr.firstDone) {
      if (power?.id === "takeover") {
        if (!cell || cell.wall || cell.owner === this.cp || cell.visible === false || cell.scored) {
          conn.send(JSON.stringify({ type: "error", message: "Pick an opponent's tile" }));
          return;
        }
        this.board[r][c] = { owner: this.cp, visible: true, anim: "steal" };
        this.lastMove = [r, c];
        this.cooldowns[this.cp] = getPowerCd("takeover", this.config.gridSize);
        this.endTurn();
        return;
      }
      if (power?.id === "block") {
        const size = getBlockSize(this.config.lineLen);
        if (r + size > this.config.gridSize || c + size > this.config.gridSize) {
          conn.send(JSON.stringify({ type: "error", message: `Block must fit on the board (${size}x${size})` })); return;
        }
        for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
          if (isBlocked(this.blocks, r + dr, c + dc, this.globalTurn)) {
            conn.send(JSON.stringify({ type: "error", message: "Overlaps an existing block" })); return;
          }
        }
        const expiresAt = this.globalTurn + 3 * this.config.playerCount;
        this.blocks.push({ r, c, size, expiresAt, owner: this.cp, createdAt: this.globalTurn });
        this.cooldowns[this.cp] = POWERS[this.config.powers[this.cp]].cd;
        this.endTurn();
        return;
      }
      if (power?.id === "teleport") {
        // Two-click: first click selects source, second chooses destination.
        if (!this.pwr.tpSource) {
          if (!cell || cell.owner !== this.cp || cell.wall || cell.scored || cell.visible === false) {
            conn.send(JSON.stringify({ type: "error", message: "Pick one of your tiles" })); return;
          }
          if (isBlocked(this.blocks, r, c, this.globalTurn)) {
            conn.send(JSON.stringify({ type: "error", message: "That tile is inside a blocked area" })); return;
          }
          this.pwr = { ...this.pwr, tpSource: [r, c] };
          this.broadcastState("power-toggled");
          return;
        }
        if (cell) { conn.send(JSON.stringify({ type: "error", message: "Destination must be empty" })); return; }
        if (isBlocked(this.blocks, r, c, this.globalTurn)) {
          conn.send(JSON.stringify({ type: "error", message: "Can't teleport into a blocked area" })); return;
        }
        const [sr, sc] = this.pwr.tpSource;
        if (sr === r && sc === c) { conn.send(JSON.stringify({ type: "error", message: "Pick a different cell" })); return; }
        const moved = { ...this.board[sr][sc], anim: "reveal" };
        this.board[sr][sc] = null;
        this.board[r][c] = moved;
        this.lastMove = [r, c];
        this.cooldowns[this.cp] = POWERS[this.config.powers[this.cp]].cd;
        this.endTurn();
        return;
      }
    }

    // Step 1: place normal tile
    if (cell) return;
    if (isBlocked(this.blocks, r, c, this.globalTurn)) {
      conn.send(JSON.stringify({ type: "error", message: "That area is currently blocked" })); return;
    }
    this.board[r][c] = { owner: this.cp, visible: true };
    this.lastMove = [r, c];

    // Double Place: every 3rd turn — first tile
    if (isPow && power?.id === "doublePlace" && ((this.playerTurns[this.cp] || 0) + 1) % 3 === 0 && !this.pwr.firstDone) {
      const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores, this.teamsArg());
      this.scores = s.scores;
      if (s.pending) {
        this.pendingLinePick = { pending: s.pending, resume: "doublePlace" };
        this.broadcastState("pending-line");
        return;
      }
      if (this.checkWin(this.scores)) return;
      this.pwr = { active: false, used: false, firstDone: true, tpSource: null };
      this.broadcastState("move-applied");
      return;
    }

    // Takeover/Block/Teleport: normal tile placed, now wait for power action
    if (this.pwr.active && !this.pwr.firstDone && (power?.id === "takeover" || power?.id === "block" || power?.id === "teleport")) {
      const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores, this.teamsArg());
      this.scores = s.scores;
      if (s.pending) {
        this.pendingLinePick = { pending: s.pending, resume: "powerFirst" };
        this.broadcastState("pending-line");
        return;
      }
      if (this.checkWin(this.scores)) return;
      this.pwr = { ...this.pwr, firstDone: true };
      this.broadcastState("move-applied");
      return;
    }

    // Normal move
    this.endTurn();
  }

  handleLineOffset(conn, data) {
    if (this.phase !== "playing" || !this.pendingLinePick) return;
    if (!this.hasAllPlayersPresent()) {
      conn.send(JSON.stringify({ type: "error", message: "Waiting for all players to reconnect" }));
      return;
    }
    const slot = this.getSlot(conn.id);
    const { pending, resume } = this.pendingLinePick;
    if (!canPickLineSlot(pending, slot)) {
      conn.send(JSON.stringify({ type: "error", message: "Not your line choice" }));
      return;
    }
    const offset = data.offset | 0;
    if (offset < 0 || offset + this.config.lineLen > pending.cells.length) return;

    const extra = this.pendingLinePick.extra;

    let r = applyPendingLineScore(
      this.board,
      this.config.playerCount,
      this.config.lineLen,
      pending,
      offset,
      this.scores,
      this.teamsArg()
    );
    this.scores = r.scores;

    while (r.pending) {
      this.pendingLinePick = { pending: r.pending, resume, extra };
      this.broadcastState("pending-line");
      return;
    }
    this.pendingLinePick = null;

    if (resume === "endTurnFirst") {
      this.afterFirstScoreOfEndTurn();
      return;
    }
    if (resume === "endTurnSecond") {
      if (this.checkWin(this.scores)) return;
      this.advanceTurnFromEndTurn();
      return;
    }
    if (resume === "doublePlace") {
      if (this.checkWin(this.scores)) return;
      this.pwr = { active: false, used: false, firstDone: true, tpSource: null };
      this.broadcastState("move-applied");
      return;
    }
    if (resume === "powerFirst") {
      if (this.checkWin(this.scores)) return;
      this.pwr = { ...this.pwr, firstDone: true };
      this.broadcastState("move-applied");
      return;
    }
  }

  handlePowerToggle(conn) {
    if (this.phase !== "playing") return;
    if (!this.hasAllPlayersPresent()) {
      conn.send(JSON.stringify({ type: "error", message: "Waiting for all players to reconnect" }));
      return;
    }
    if (this.pendingLinePick) return;
    const slot = this.getSlot(conn.id);
    if (slot !== this.cp) return;
    if (this.config?.mode !== "powers") return;
    const power = POWERS[this.config.powers[this.cp]];
    if (!power || power.id === "doublePlace") return;
    if ((this.cooldowns[this.cp] || 0) > 0) {
      conn.send(JSON.stringify({ type: "error", message: "Power is on cooldown" }));
      return;
    }

    if (this.pwr.active && !this.pwr.firstDone) {
      this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
    } else if (!this.pwr.active) {
      this.pwr = { active: true, used: true, firstDone: false, tpSource: null };
    }
    this.broadcastState("power-toggled");
  }

  handleRematch(conn) {
    if (this.phase !== "review") return;
    const slot = this.getSlot(conn.id);
    if (slot < 0) return; // spectator or unknown
    // Tally the vote
    this.rematchVotes.add(slot);
    const activeSlots = this.players.filter(p => !p.disconnected && !p.spectator).map(p => p.slot);
    const voted = activeSlots.filter(s => this.rematchVotes.has(s));
    this.broadcast({
      type: "rematch-vote",
      votedSlots: voted,
      needed: activeSlots.length,
      count: voted.length,
    });
    // Require every connected, non-spectator player to vote
    const everyoneReady = activeSlots.length > 0 && activeSlots.every(s => this.rematchVotes.has(s));
    if (!everyoneReady) return;
    if (!this.config) { this.rematchVotes.clear(); this.phase = "lobby"; this.broadcastState("rematch"); return; }
    this.stopTimer();
    this.rematchVotes.clear();
    // Reset game state; keep config and players
    this.phase = "playing";
    this.board = makeBoard(this.config.gridSize);
    this.cp = 0;
    this.turn = 1;
    this.globalTurn = 1;
    this.scores = {};
    this.cooldowns = {};
    this.playerTurns = {};
    this.lastMove = null;
    this.winner = null;
    this.isDraw = false;
    this.winCells = [];
    this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
    this.blocks = [];
    this.timeLeft = this.config.timer || 0;
    this.pendingLinePick = null;
    this.broadcastState("game-started");
    this.startTimer();
  }

  endTurn() {
    const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores, this.teamsArg());
    this.scores = s.scores;
    if (s.pending) {
      this.pendingLinePick = { pending: s.pending, resume: "endTurnFirst" };
      this.broadcastState("pending-line");
      return;
    }
    this.afterFirstScoreOfEndTurn();
  }

  afterFirstScoreOfEndTurn() {
    if (this.checkWin(this.scores)) return;
    if (isBoardFull(this.board)) {
      this.phase = "review";
      this.isDraw = true;
      this.stopTimer();
      this.broadcastState("game-over");
      return;
    }

    const next = (this.cp + 1) % this.config.playerCount;
    const nextGT = this.globalTurn + 1;
    const nextRound = next === 0 ? this.turn + 1 : this.turn;

    if (this.cooldowns[next] > 0) this.cooldowns[next]--;

    this.board = revealGhosts(this.board, nextRound);
    const s2 = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores, this.teamsArg());
    this.scores = s2.scores;
    if (s2.pending) {
      this.pendingLinePick = { pending: s2.pending, resume: "endTurnSecond" };
      this.broadcastState("pending-line");
      return;
    }
    if (this.checkWin(this.scores)) return;

    this.advanceTurnFromEndTurn();
  }

  advanceTurnFromEndTurn() {
    const next = (this.cp + 1) % this.config.playerCount;
    const nextGT = this.globalTurn + 1;
    this.playerTurns[this.cp] = (this.playerTurns[this.cp] || 0) + 1;
    this.cp = next;
    this.globalTurn = nextGT;
    if (next === 0) this.turn++;
    this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
    this.blocks = pruneBlocks(this.blocks, nextGT);
    this.timeLeft = this.config.timer || 0;

    this.broadcastState("move-applied");
    this.startTimer();
  }

  checkWin(scores) {
    for (let p = 0; p < this.config.playerCount; p++) {
      if ((scores[p] || 0) >= this.config.linesNeeded) {
        this.winner = p;
        this.winCells = getScoredCells(this.board, p);
        this.phase = "review";
        this.stopTimer();
        this.broadcastState("game-over");
        return true;
      }
    }
    return false;
  }

  startTimer() {
    this.stopTimer();
    if (!this.config?.timer) return;
    this.timerInterval = setInterval(() => {
      if (this.pendingLinePick) return;
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.stopTimer();
        // Random move on timeout
        const empty = [];
        for (let r = 0; r < this.board.length; r++)
          for (let c = 0; c < this.board[0].length; c++) {
            if (this.board[r][c]) continue;
            if (isBlocked(this.blocks, r, c, this.globalTurn)) continue;
            empty.push([r, c]);
          }
        if (empty.length > 0) {
          const [r, c] = empty[Math.floor(Math.random() * empty.length)];
          this.pwr = { active: false, used: false, firstDone: false, tpSource: null };
          this.board[r][c] = { owner: this.cp, visible: true };
          this.lastMove = [r, c];
          this.endTurn();
        }
      } else {
        this.broadcast({ type: "timer-tick", timeLeft: this.timeLeft });
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  getSlot(connId) {
    const p = this.players.find(p => p.id === connId);
    return p ? p.slot : -1;
  }

  getState() {
    const seatedPlayers = this.players
      .filter(p => !p.spectator && !p.disconnected)
      .map(p => ({ slot: p.slot, name: p.name }));
    const spectators = this.players
      .filter(p => p.spectator && !p.disconnected)
      .map(p => ({ name: p.name }));

    return {
      phase: this.phase,
      config: this.config,
      board: this.board,
      cp: this.cp,
      turn: this.turn,
      globalTurn: this.globalTurn,
      scores: this.scores,
      cooldowns: this.cooldowns,
      playerTurns: this.playerTurns,
      lastMove: this.lastMove,
      winner: this.winner,
      isDraw: this.isDraw,
      winCells: this.winCells,
      pwr: this.pwr,
      blocks: this.blocks,
      timeLeft: this.timeLeft,
      pendingLinePick: this.pendingLinePick,
      players: seatedPlayers,
      spectators,
    };
  }

  broadcastState(event) {
    for (const conn of this.room.getConnections()) {
      const slot = this.getSlot(conn.id);
      conn.send(JSON.stringify({ type: event, ...this.getState(), you: slot }));
    }
  }

  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const conn of this.room.getConnections()) {
      conn.send(json);
    }
  }
}
