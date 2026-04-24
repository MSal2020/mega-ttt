/**
 * Lobby party: a single singleton room named "public" that tracks all
 * publicly-listed game rooms. Game rooms send HTTP POST to register/update/
 * unregister. Browser clients connect via WebSocket to receive the live list.
 */
const ROOMS_STORAGE_KEY = "public-rooms";
const STALE_ROOM_AGE_MS = 120_000;
const DEBUG_EVENT_TYPE = "lobby-debug";

export default class Lobby {
  constructor(room) {
    this.room = room;
    this.rooms = new Map(); // code -> { code, hostName, players, playerCount, gridSize, mode, updatedAt }
    this.ready = this.loadRoomsFromStorage();
  }

  async loadRoomsFromStorage() {
    const storage = this.room.storage;
    if (!storage) return;
    try {
      const saved = await storage.get(ROOMS_STORAGE_KEY);
      if (!Array.isArray(saved)) return;
      this.rooms = new Map(saved.map((r) => [r.code, r]));
      const pruned = this.pruneStaleRooms("startup");
      if (pruned.length > 0) this.broadcastDebug({ event: "prune", source: "startup", pruned });
    } catch {}
  }

  async persistRooms() {
    const storage = this.room.storage;
    if (!storage) return;
    try {
      await storage.put(ROOMS_STORAGE_KEY, [...this.rooms.values()]);
    } catch {}
  }

  pruneStaleRooms(source = "unknown") {
    const now = Date.now();
    const pruned = [];
    for (const [k, v] of this.rooms) {
      const ageMs = now - (v.updatedAt || 0);
      const players = Number(v.players || 0);
      // Drop ghost listings aggressively: they should never be visible at 0/N.
      if (players < 1 || ageMs > STALE_ROOM_AGE_MS) {
        this.rooms.delete(k);
        pruned.push({ code: k, players, ageMs });
      }
    }
    if (pruned.length > 0) {
      this.broadcastDebug({ event: "prune", source, pruned });
    }
    return pruned;
  }

  broadcastDebug(payload) {
    const msg = JSON.stringify({
      type: DEBUG_EVENT_TYPE,
      at: Date.now(),
      roomCount: this.rooms.size,
      ...payload,
    });
    for (const c of this.room.getConnections()) c.send(msg);
  }

  // HTTP from game rooms (server-to-server within PartyKit)
  async onRequest(req) {
    await this.ready;
    if (req.method !== "POST") return new Response("ok");
    let data;
    try { data = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
    const { action } = data;
    const code = String(data.code || "").toUpperCase();
    if (!code || typeof code !== "string") return new Response("missing code", { status: 400 });
    const source = String(data.source || "unknown");
    const beforeCount = this.rooms.size;

    if (action === "remove") {
      this.rooms.delete(code);
    } else {
      // register / update
      const players = Number(data.players || 0);
      if (players < 1) {
        this.rooms.delete(code);
      } else {
        this.rooms.set(code, {
        code,
        hostName: (data.hostName || "").slice(0, 20),
        players,
        spectators: data.spectators || 0,
        playerCount: data.playerCount || 2,
        gridSize: data.gridSize || 12,
        mode: data.mode || "normal",
        teams: !!data.teams,
        phase: data.phase || "lobby",
        updatedAt: Date.now(),
      });
      }
    }
    this.pruneStaleRooms(source);
    await this.persistRooms();
    this.broadcastDebug({
      event: "publish",
      source,
      action,
      code,
      beforeCount,
      afterCount: this.rooms.size,
      players: Number(data.players || 0),
      isPublic: !!data.isPublic,
      phase: data.phase || "unknown",
    });
    this.broadcastList();
    return new Response("ok");
  }

  async onConnect(conn) {
    await this.ready;
    this.pruneStaleRooms("connect");
    await this.persistRooms();
    conn.send(JSON.stringify({ type: "rooms", rooms: [...this.rooms.values()] }));
    conn.send(JSON.stringify({
      type: DEBUG_EVENT_TYPE,
      at: Date.now(),
      event: "snapshot",
      source: "connect",
      roomCount: this.rooms.size,
      rooms: [...this.rooms.values()].map((r) => ({ code: r.code, players: r.players, playerCount: r.playerCount })),
    }));
  }

  broadcastList() {
    this.pruneStaleRooms("broadcast");
    const msg = JSON.stringify({ type: "rooms", rooms: [...this.rooms.values()] });
    for (const c of this.room.getConnections()) c.send(msg);
  }
}
