import PartySocket from "partysocket";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

export function createConnection(roomCode, onMessage) {
  console.log("[multiplayer] connecting to", PARTYKIT_HOST, "room:", roomCode.toUpperCase());
  // Stable client ID so server can reclaim slot on reconnect
  let clientId = sessionStorage.getItem("mtt-client-id");
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("mtt-client-id", clientId);
  }
  const ws = new PartySocket({
    host: PARTYKIT_HOST,
    room: roomCode.toUpperCase(),
    id: clientId,
  });

  let lastName = null;

  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {}
  });

  // Re-send join on every (re)connect so server can restore slot
  ws.addEventListener("open", () => {
    if (lastName) ws.send(JSON.stringify({ type: "join", name: lastName }));
  });

  const send = (msg) => {
    // PartySocket queues messages while reconnecting
    ws.send(JSON.stringify(msg));
    return true;
  };

  return {
    ws,
    clientId,
    isOpen() { return ws.readyState === 1; },
    send(msg) { return send(msg); },
    join(name) { lastName = name; return send({ type: "join", name }); },
    rename(name) { lastName = name; return send({ type: "rename", name }); },
    setConfig(config) { return send({ type: "config", config }); },
    start() { return send({ type: "start" }); },
    move(r, c) { return send({ type: "move", r, c }); },
    powerToggle() { return send({ type: "power-toggle" }); },
    rematch() { return send({ type: "rematch" }); },
    emote(emote) { return send({ type: "emote", emote }); },
    close() { ws.close(); },
  };
}

// Subscribe to the public-rooms list from the lobby party.
// onRooms(list) is called on every update.
export function subscribeToLobby(onRooms) {
  const ws = new PartySocket({ host: PARTYKIT_HOST, party: "lobby", room: "public" });
  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "rooms") onRooms(data.rooms || []);
    } catch {}
  });
  return { ws, close() { ws.close(); } };
}

