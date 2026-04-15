import {
  makeBoard, cloneBoard, scoreAndMark, revealGhosts,
  isBoardFull, getScoredCells, POWERS,
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
    this.pwr = { active: false, used: false, firstDone: false };
    this.timerInterval = null;
    this.timeLeft = 0;
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
    if (this.phase === "playing") {
      this.stopTimer();
      this.broadcast({ type: "opponent-disconnected" });
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
      case "power-toggle": return this.handlePowerToggle(conn);
      case "rematch": return this.handleRematch(conn);
      default: break;
    }
  }

  handleJoin(conn, data) {
    // Reclaim slot if a player with this id was previously here
    const existing = this.players.find(p => p.id === conn.id);
    if (existing) {
      existing.disconnected = false;
      conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: existing.slot }));
      this.broadcast({ type: "player-joined", slot: existing.slot, name: existing.name, playerCount: this.activePlayerCount() });
      return;
    }
    const activeCount = this.players.filter(p => !p.disconnected).length;
    if (activeCount >= 2) {
      conn.send(JSON.stringify({ type: "error", message: "Room is full" }));
      return;
    }
    // Take the lowest free slot (handles case where slot 0 was freed)
    const takenSlots = new Set(this.players.filter(p => !p.disconnected).map(p => p.slot));
    const slot = takenSlots.has(0) ? 1 : 0;
    const name = (data.name || `Player ${slot + 1}`).slice(0, 20);
    // Remove any stale disconnected entry occupying this slot
    this.players = this.players.filter(p => p.slot !== slot || !p.disconnected);
    this.players.push({ id: conn.id, name, slot, disconnected: false });

    conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: slot }));
    this.broadcast({ type: "player-joined", slot, name, playerCount: this.activePlayerCount() });
  }

  handleRename(conn, data) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    const name = (data.name || "").slice(0, 20).trim();
    if (!name) return;
    player.name = name;
    this.broadcast({ type: "player-joined", slot: player.slot, name, playerCount: this.activePlayerCount() });
  }

  activePlayerCount() {
    return this.players.filter(p => !p.disconnected).length;
  }

  handleConfig(conn, data) {
    if (this.getSlot(conn.id) !== 0) return; // only host
    if (this.phase !== "lobby") return;
    this.config = data.config;
    this.broadcast({ type: "config-updated", config: this.config });
  }

  handleStart(conn) {
    if (this.getSlot(conn.id) !== 0) return; // only host
    if (this.activePlayerCount() < 2) {
      conn.send(JSON.stringify({ type: "error", message: "Need 2 players" }));
      return;
    }
    if (!this.config) {
      conn.send(JSON.stringify({ type: "error", message: "Set config first" }));
      return;
    }

    // Initialize game
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
    this.pwr = { active: false, used: false, firstDone: false };
    this.timeLeft = this.config.timer || 0;

    this.broadcastState("game-started");
    this.startTimer();
  }

  handleMove(conn, data) {
    if (this.phase !== "playing") return;
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
        this.cooldowns[this.cp] = POWERS[this.config.powers[this.cp]].cd;
        this.endTurn();
        return;
      }
      if (power?.id === "block") {
        if (cell) { conn.send(JSON.stringify({ type: "error", message: "Pick an empty cell" })); return; }
        this.board[r][c] = { wall: true, anim: "wall" };
        this.cooldowns[this.cp] = POWERS[this.config.powers[this.cp]].cd;
        this.endTurn();
        return;
      }
      if (power?.id === "ghost") {
        if (cell) { conn.send(JSON.stringify({ type: "error", message: "Pick an empty cell" })); return; }
        this.board[r][c] = { owner: this.cp, visible: false, placedTurn: this.turn, anim: "ghost" };
        this.lastMove = [r, c];
        this.endTurn();
        return;
      }
    }

    // Step 1: place normal tile
    if (cell) return;
    this.board[r][c] = { owner: this.cp, visible: true };
    this.lastMove = [r, c];

    // Double Place: first tile
    if (isPow && power?.id === "doublePlace" && (this.playerTurns[this.cp] || 0) % 2 === 1 && !this.pwr.firstDone) {
      const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores);
      this.scores = s;
      if (this.checkWin(s)) return;
      this.pwr = { active: false, used: false, firstDone: true };
      this.broadcastState("move-applied");
      return;
    }

    // Takeover/Block/Ghost: normal tile placed, now wait for power action
    if (this.pwr.active && !this.pwr.firstDone && (power?.id === "takeover" || power?.id === "block" || power?.id === "ghost")) {
      const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores);
      this.scores = s;
      if (this.checkWin(s)) return;
      this.pwr = { ...this.pwr, firstDone: true };
      this.broadcastState("move-applied");
      return;
    }

    // Normal move
    this.endTurn();
  }

  handlePowerToggle(conn) {
    if (this.phase !== "playing") return;
    const slot = this.getSlot(conn.id);
    if (slot !== this.cp) return;

    if (this.pwr.active && !this.pwr.firstDone) {
      this.pwr = { active: false, used: false, firstDone: false };
    } else if (!this.pwr.active) {
      this.pwr = { active: true, used: true, firstDone: false };
    }
    this.broadcastState("power-toggled");
  }

  handleRematch(conn) {
    if (this.phase !== "review") return;
    // Only host can trigger rematch (avoids race between both players clicking)
    if (this.getSlot(conn.id) !== 0) return;
    if (!this.config) { this.phase = "lobby"; this.broadcastState("rematch"); return; }
    this.stopTimer();
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
    this.pwr = { active: false, used: false, firstDone: false };
    this.timeLeft = this.config.timer || 0;
    this.broadcastState("game-started");
    this.startTimer();
  }

  endTurn() {
    const s = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, this.scores);
    this.scores = s;
    if (this.checkWin(s)) return;
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
    const s2 = scoreAndMark(this.board, this.config.playerCount, this.config.lineLen, s);
    this.scores = s2;
    if (this.checkWin(s2)) return;

    this.playerTurns[this.cp] = (this.playerTurns[this.cp] || 0) + 1;
    this.cp = next;
    this.globalTurn = nextGT;
    if (next === 0) this.turn++;
    this.pwr = { active: false, used: false, firstDone: false };
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
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.stopTimer();
        // Random move on timeout
        const empty = [];
        for (let r = 0; r < this.board.length; r++)
          for (let c = 0; c < this.board[0].length; c++)
            if (!this.board[r][c]) empty.push([r, c]);
        if (empty.length > 0) {
          const [r, c] = empty[Math.floor(Math.random() * empty.length)];
          this.pwr = { active: false, used: false, firstDone: false };
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
      timeLeft: this.timeLeft,
      players: this.players.map(p => ({ slot: p.slot, name: p.name })),
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
