import PartySocket from "partysocket";

function resolvePartykitHost() {
  const configured = import.meta.env.VITE_PARTYKIT_HOST;
  const hostname = window.location.hostname;
  const isLocalUi = hostname === "localhost" || hostname === "127.0.0.1";
  // In local UI sessions, default to local PartyKit to avoid accidentally
  // talking to production when shell env still exports VITE_PARTYKIT_HOST.
  if (isLocalUi) return "localhost:1999";
  return configured || "localhost:1999";
}

const PARTYKIT_HOST = resolvePartykitHost();

export function createConnection(roomCode, onMessage) {
  const room = roomCode.toUpperCase();
  // Stable client ID so server can reclaim slot on reconnect
  let clientId = sessionStorage.getItem("mtt-client-id");
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("mtt-client-id", clientId);
  }
  const ws = new PartySocket({
    host: PARTYKIT_HOST,
    room,
    id: clientId,
  });

  let lastName = null;
  let openedOnce = false;

  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {}
  });

  // Re-send join on every (re)connect so server can restore slot
  ws.addEventListener("open", () => {
    if (openedOnce && lastName) ws.send(JSON.stringify({ type: "join", name: lastName }));
    openedOnce = true;
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
    lineOffset(offset) { return send({ type: "line-offset", offset }); },
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

