/**
 * Lobby party: a single singleton room named "public" that tracks all
 * publicly-listed game rooms. Game rooms send HTTP POST to register/update/
 * unregister. Browser clients connect via WebSocket to receive the live list.
 */
export default class Lobby {
  constructor(room) {
    this.room = room;
    this.rooms = new Map(); // code -> { code, hostName, players, playerCount, gridSize, mode, updatedAt }
  }

  pruneStaleRooms() {
    const now = Date.now();
    for (const [k, v] of this.rooms) {
      if (now - v.updatedAt > 60_000) this.rooms.delete(k);
    }
  }

  // HTTP from game rooms (server-to-server within PartyKit)
  async onRequest(req) {
    if (req.method !== "POST") return new Response("ok");
    let data;
    try { data = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
    const { action } = data;
    const code = String(data.code || "").toUpperCase();
    if (!code || typeof code !== "string") return new Response("missing code", { status: 400 });

    if (action === "remove") {
      this.rooms.delete(code);
    } else {
      // register / update
      this.rooms.set(code, {
        code,
        hostName: (data.hostName || "").slice(0, 20),
        players: data.players || 0,
        playerCount: data.playerCount || 2,
        gridSize: data.gridSize || 12,
        mode: data.mode || "normal",
        teams: !!data.teams,
        updatedAt: Date.now(),
      });
    }
    this.pruneStaleRooms();
    this.broadcastList();
    return new Response("ok");
  }

  onConnect(conn) {
    this.pruneStaleRooms();
    conn.send(JSON.stringify({ type: "rooms", rooms: [...this.rooms.values()] }));
  }

  broadcastList() {
    this.pruneStaleRooms();
    const msg = JSON.stringify({ type: "rooms", rooms: [...this.rooms.values()] });
    for (const c of this.room.getConnections()) c.send(msg);
  }
}
