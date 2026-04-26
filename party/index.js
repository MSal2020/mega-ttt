import {
  makeBoard, cloneBoard, scoreAndMark, applyPendingLineScore, revealGhosts,
  isBoardFull, getScoredCells, POWERS,
  getBlockSize, getPowerCd, isBlocked, pruneBlocks,
  canPickLineSlot,
} from "../lib/gameLogic.js";

const LISTING_HEARTBEAT_MS = 5_000;
const GRACE_MS = 10_000;

/**
 * PartyKit server for Mega Tic Tac Toe online multiplayer.
 * Each room = one game session identified by a 4-char code.
 * Server-authoritative: validates every move, broadcasts state.
 */
export default class MegaTTTServer {
  constructor(room) {
    this.room = room;
    this._host = null;   // captured from incoming requests; needed in onAlarm
    this._roomId = null; // cache room.id; PartyKit blocks access in onAlarm
    try { this._roomId = room?.id || null; } catch {}
    this.reset();
    this._envReady = this._restoreEnv();
  }

  async _restoreEnv() {
    try {
      const [h, id] = await Promise.all([
        this.room?.storage?.get?.("pk-host"),
        this.room?.storage?.get?.("pk-room-id"),
      ]);
      if (h && !this._host) this._host = h;
      if (id && !this._roomId) this._roomId = id;
    } catch {}
  }

  _captureHost(ctxOrReq) {
    try {
      const req = ctxOrReq?.request || ctxOrReq;
      if (!req?.url) return;
      const u = new URL(req.url);
      const proto = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol;
      const host = `${proto}//${u.host}`;
      if (host !== this._host) {
        this._host = host;
        this.room?.storage?.put?.("pk-host", host);
      }
      // Also persist room.id while we're in a context where it's accessible.
      if (!this._roomId) {
        try { this._roomId = this.room?.id || null; } catch {}
        if (this._roomId) this.room?.storage?.put?.("pk-room-id", this._roomId);
      }
    } catch {}
  }

  reset() {
    // Cancel any pending listing-heartbeat alarm. Fire-and-forget; if storage
    // isn't available (test envs) just skip.
    try { this.room?.storage?.deleteAlarm?.(); } catch {}
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
    for (const timer of (this.graceTimers || new Map()).values()) clearTimeout(timer);
    this.graceTimers = new Map();
  }

  onConnect(conn, ctx) {
    this._captureHost(ctx);
    // Cancel grace timer if reconnecting
    const timer = this.graceTimers.get(conn.id);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(conn.id);
      const player = this.players.find(p => p.id === conn.id);
      if (player) {
        player.disconnected = false;
        player.forfeited = false;
      }
    }
    // Send current full state on connect/reconnect
    conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: this.getSlot(conn.id) }));
  }

  onClose(conn) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    if (player.spectator) {
      // Remove spectator immediately — no reclaim needed
      this.players = this.players.filter(p => p.id !== conn.id);
      this.publishListing("on-close");
      return;
    }
    // Mark disconnected but keep slot reserved so they can reclaim on reconnect
    player.disconnected = true;
    this.broadcast({ type: "player-left", slot: player.slot, name: player.name });
    if (this.phase === "playing") {
      // Grace period: don't stop the game immediately
      const timer = setTimeout(() => this.finalizeDisconnect(conn.id), GRACE_MS);
      this.graceTimers.set(conn.id, timer);
      this.broadcast({ type: "player-grace", slot: player.slot, name: player.name, graceUntil: Date.now() + GRACE_MS });
    }
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

    this.publishListing("on-close");

    // If no seated players remain in lobby, close/reset room state immediately.
    if (this.phase === "lobby" && this.activePlayerCount() === 0) {
      this.reset();
      return;
    }

    // If literally no one is connected anymore, reset so the room code can be reused fresh.
    if ([...this.room.getConnections()].length === 0) {
      this.reset();
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
      case "forfeit": return this.handleForfeit(conn);
      default: break;
    }
  }

  handleEmote(conn, data) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    if (!data.emote || typeof data.emote !== "string" || data.emote.length > 16) return;
    this.broadcast({ type: "emote", slot: player.spectator ? -1 : player.slot, name: player.name, emote: data.emote, at: Date.now() });
  }

  handleJoin(conn, data) {
    // Reclaim slot if a player with this id was previously here
    const existing = this.players.find(p => p.id === conn.id);
    if (existing) {
      existing.disconnected = false;
      existing.forfeited = false;
      const timer = this.graceTimers.get(conn.id);
      if (timer) { clearTimeout(timer); this.graceTimers.delete(conn.id); }
      conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: existing.slot }));
      if (existing.spectator) {
        this.broadcast({ type: "spectator-joined", name: existing.name });
      } else {
        this.broadcast({ type: "player-joined", slot: existing.slot, name: existing.name, playerCount: this.activePlayerCount() });
      }
      return;
    }
    // Explicit spectator opt-in (Spectate button) — works in any phase.
    // Also: during an active game or review, new joiners can only spectate
    // (no slot stealing).
    if (data.asSpectator || this.phase === "playing" || this.phase === "review") {
      const name = (data.name || "Spectator").slice(0, 20);
      this.players.push({ id: conn.id, name, slot: -1, disconnected: false, spectator: true });
      conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: -1, spectator: true }));
      this.broadcast({ type: "spectator-joined", name });
      return;
    }
    // Cap = host's chosen playerCount (defaults to 4 before config is set)
    const cap = this.config?.playerCount || 4;
    const activeCount = this.players.filter(p => !p.disconnected && !p.spectator).length;
    if (activeCount >= cap) {
      // Lobby is full — reject the join so the client can show a clear error
      conn.send(JSON.stringify({ type: "error", message: "Room is full" }));
      return;
    }
    // Take the lowest free slot (handles freed/reordered slots)
    // Reserved slots include all seated players (even disconnected ones) to prevent slot stealing
    const takenSlots = new Set(this.players.filter(p => !p.spectator && !p.forfeited).map(p => p.slot));
    let slot = 0;
    while (takenSlots.has(slot)) slot++;
    if (slot >= cap) {
      // All cap slots are reserved by seated (possibly disconnected) players.
      // Reject so we don't seat a slot beyond the configured player count.
      conn.send(JSON.stringify({ type: "error", message: "Room is full" }));
      return;
    }
    const name = (data.name || `Player ${slot + 1}`).slice(0, 20);
    // Only remove forfeited players occupying this slot
    this.players = this.players.filter(p => p.slot !== slot || !p.forfeited);
    this.players.push({ id: conn.id, name, slot, disconnected: false });

    conn.send(JSON.stringify({ type: "room-state", ...this.getState(), you: slot }));
    this.broadcast({ type: "player-joined", slot, name, playerCount: this.activePlayerCount() });
    this.publishListing("join");
  }

  handleRename(conn, data) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player) return;
    const name = (data.name || "").slice(0, 20).trim();
    if (!name) return;
    const oldName = player.name;
    player.name = name;
    if (player.spectator) {
      this.broadcast({ type: "spectator-renamed", oldName, name });
      return;
    }
    this.broadcast({ type: "player-joined", slot: player.slot, name, playerCount: this.activePlayerCount() });
    if (player.slot === 0) this.publishListing("host-rename");
  }

  activePlayerCount() {
    return this.players.filter(p => !p.disconnected && !p.spectator && !p.forfeited).length;
  }

  hasAllPlayersPresent() {
    // No longer blocks the game when players disconnect
    return true;
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
    this.publishListing("config");
  }

  async publishListing(source = "unknown") {
    // Ensure persisted host/roomId are restored before we try to publish.
    if (this._envReady) { try { await this._envReady; } catch {} }
    const hasSeatedPlayers = this.players.filter(p => !p.spectator).length > 0;
    const shouldList = !!(this.config?.public && hasSeatedPlayers);
    await this.syncListingHeartbeat(shouldList);
    const host = this.players.find(p => p.slot === 0);
    let roomId = this._roomId;
    if (!roomId) {
      try { roomId = this.room?.id; } catch {}
    }
    if (!roomId) return; // can't publish without an id
    const payload = {
      action: shouldList ? "set" : "remove",
      code: roomId,
      source,
      hostName: host?.name || "Host",
      players: this.activePlayerCount(),
      spectators: this.players.filter(p => p.spectator && !p.disconnected).length,
      playerCount: this.config?.playerCount || 2,
      gridSize: this.config?.gridSize || 12,
      mode: this.config?.mode || "normal",
      teams: !!this.config?.teams,
      isPublic: !!this.config?.public,
      phase: this.phase,
    };
    // Use direct fetch instead of parties.lobby stub. The stub approach is
    // forbidden inside `onAlarm` (PartyKit limitation), so we standardise on
    // plain fetch in all paths. Host is captured from incoming requests.
    if (!this._host) {
      // Best effort: try parties stub once if available (warm path before
      // any alarm has fired). Used for the very first publish.
      try {
        const parties = this.room.context?.parties;
        const stub = parties?.lobby?.get?.("public");
        if (stub) {
          await stub.fetch({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          return;
        }
      } catch {}
      return;
    }
    try {
      await fetch(`${this._host}/parties/lobby/public`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }

  async syncListingHeartbeat(shouldHeartbeat) {
    // Heartbeat uses Durable Object alarms instead of setInterval. Alarms
    // survive hibernation (which Cloudflare does aggressively even with
    // active WebSockets), wake the DO to fire publishListing, and the
    // alarm handler reschedules itself. setInterval was unreliable in
    // production because timers stop when the DO hibernates.
    const storage = this.room?.storage;
    if (!storage?.setAlarm) return;
    try {
      if (!shouldHeartbeat) {
        await storage.deleteAlarm();
        return;
      }
      const existing = await storage.getAlarm();
      if (existing && existing > Date.now()) return; // already scheduled
      await storage.setAlarm(Date.now() + LISTING_HEARTBEAT_MS);
    } catch {}
  }

  async onAlarm() {
    // Wake-up trigger from a scheduled alarm. Decide if we still need to
    // keep the listing alive; if so, publish and reschedule. Otherwise the
    // alarm chain stops on its own.
    const hasSeatedPlayers = this.players.filter(p => !p.spectator).length > 0;
    const shouldList = !!(this.config?.public && hasSeatedPlayers);
    if (!shouldList) return;
    await this.publishListing("alarm");
    // publishListing → syncListingHeartbeat will schedule the next alarm.
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
    this.publishListing("start-game"); // remove from public list — no longer joinable as lobby
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

    if (r.pending) {
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
    for (const timer of this.graceTimers.values()) clearTimeout(timer);
    this.graceTimers.clear();
    // Reset game state; keep config and players, clear forfeits
    for (const p of this.players) p.forfeited = false;
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

    const nextRound = ((this.cp + 1) % this.config.playerCount) === 0 ? this.turn + 1 : this.turn;

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
    let next = (this.cp + 1) % this.config.playerCount;
    let nextGT = this.globalTurn + 1;
    let crossedZero = next === 0;

    // Skip forfeited players
    let guard = 0;
    while (guard < this.config.playerCount) {
      const p = this.players.find(x => x.slot === next && !x.spectator);
      if (p?.forfeited) {
        next = (next + 1) % this.config.playerCount;
        nextGT++;
        if (next === 0) crossedZero = true;
        guard++;
      } else {
        break;
      }
    }

    // Decrement cooldown for the player whose turn is actually starting
    // (must run after forfeit skipping so we don't tick a forfeited slot).
    if (this.cooldowns[next] > 0) this.cooldowns[next]--;

    this.playerTurns[this.cp] = (this.playerTurns[this.cp] || 0) + 1;
    this.cp = next;
    this.globalTurn = nextGT;
    if (crossedZero) this.turn++;
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
    if (!this.config?.timer) {
      // Non-timer games: if current player is forfeited, auto-play after a short delay
      const p = this.players.find(x => x.slot === this.cp && !x.spectator);
      if (p?.forfeited) {
        setTimeout(() => this.autoPlayTurn(), 500);
      }
      return;
    }
    // If current player is forfeited, auto-play immediately
    const p = this.players.find(x => x.slot === this.cp && !x.spectator);
    if (p?.forfeited) {
      this.autoPlayTurn();
      return;
    }
    this.timerInterval = setInterval(() => {
      if (this.pendingLinePick) return;
      this.timeLeft--;
      if (this.timeLeft <= 0) {
        this.stopTimer();
        this.autoPlayTurn();
      } else {
        this.broadcast({ type: "timer-tick", timeLeft: this.timeLeft });
      }
    }, 1000);
  }

  autoPlayTurn() {
    if (this.phase !== "playing") return;
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
    } else {
      this.afterFirstScoreOfEndTurn();
    }
  }

  finalizeDisconnect(connId) {
    this.graceTimers.delete(connId);
    const player = this.players.find(p => p.id === connId);
    if (!player || player.spectator) return;
    if (!player.disconnected) return; // reconnected in time

    player.forfeited = true;
    this.broadcast({ type: "player-forfeited", slot: player.slot, name: player.name });

    const activeCount = this.players.filter(p => !p.spectator && !p.forfeited).length;
    if (activeCount <= 1) {
      const winner = this.players.find(p => !p.spectator && !p.forfeited);
      if (winner) {
        this.winner = winner.slot;
        this.winCells = getScoredCells(this.board, winner.slot);
        this.phase = "review";
        this.stopTimer();
        this.broadcastState("game-over");
      } else {
        this.phase = "review";
        this.isDraw = true;
        this.stopTimer();
        this.broadcastState("game-over");
      }
      return;
    }

    if (this.phase === "playing" && this.cp === player.slot) {
      this.stopTimer();
      this.autoPlayTurn();
    }
  }

  handleForfeit(conn) {
    const player = this.players.find(p => p.id === conn.id);
    if (!player || player.spectator) return;
    if (this.phase !== "playing" && this.phase !== "review") return;
    const timer = this.graceTimers.get(conn.id);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(conn.id);
    }
    if (player.forfeited) return;
    this.finalizeDisconnect(conn.id);
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
    const seatedPlayers = this.players.filter(p => !p.spectator).map(p => ({ slot: p.slot, name: p.name, disconnected: p.disconnected }));
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
      forfeitedSlots: this.players.filter(p => p.forfeited && !p.spectator).map(p => p.slot),
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
