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

function loadOrCreate(key) {
  try {
    let v = localStorage.getItem(key);
    if (!v) {
      v = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function createConnection(roomCode, onMessage) {
  const room = roomCode.toUpperCase();
  // Stable per-browser client ID so server can reclaim slot during a live ws session
  const clientId = loadOrCreate("mtt-client-id");
  // Per-room rejoin token: only the original player can reclaim their slot
  // after a disconnect/grace expiry. Stored separately per room code.
  const roomToken = loadOrCreate(`mtt-token-${room}`);
  const ws = new PartySocket({
    host: PARTYKIT_HOST,
    room,
    id: clientId,
  });

  let lastName = null;
  let lastAsSpectator = false;
  let openedOnce = false;

  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {}
  });

  // Re-send join on every (re)connect so server can restore slot/spectator
  ws.addEventListener("open", () => {
    if (openedOnce && lastName) {
      const msg = { type: "join", name: lastName, token: roomToken };
      if (lastAsSpectator) msg.asSpectator = true;
      ws.send(JSON.stringify(msg));
    }
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
    roomToken,
    isOpen() { return ws.readyState === 1; },
    send(msg) { return send(msg); },
    join(name, opts = {}) {
      lastName = name;
      lastAsSpectator = !!opts.asSpectator;
      const msg = { type: "join", name, token: roomToken };
      if (lastAsSpectator) msg.asSpectator = true;
      return send(msg);
    },
    rename(name) { lastName = name; return send({ type: "rename", name }); },
    setConfig(config) { return send({ type: "config", config }); },
    start() { return send({ type: "start" }); },
    move(r, c) { return send({ type: "move", r, c }); },
    lineOffset(offset) { return send({ type: "line-offset", offset }); },
    powerToggle() { return send({ type: "power-toggle" }); },
    rematch() { return send({ type: "rematch" }); },
    emote(emote) { return send({ type: "emote", emote }); },
    forfeit() { return send({ type: "forfeit" }); },
    close() { ws.close(); },
  };
}

// Subscribe to the public-rooms list from the lobby party.
// onRooms(list) is called on every update.
// Optional onStatus(state) is called with "connected" | "reconnecting" | "error".
export function subscribeToLobby(arg) {
  const onRooms = typeof arg === "function" ? arg : arg?.onRooms;
  const onDebug = typeof arg === "function" ? null : arg?.onDebug;
  const onStatus = typeof arg === "function" ? null : arg?.onStatus;
  const ws = new PartySocket({ host: PARTYKIT_HOST, party: "lobby", room: "public" });
  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "rooms") onRooms(data.rooms || []);
      if (data.type === "lobby-debug" && onDebug) onDebug(data);
    } catch {}
  });
  if (onStatus) {
    ws.addEventListener("open", () => onStatus("connected"));
    ws.addEventListener("close", () => onStatus("reconnecting"));
    ws.addEventListener("error", () => onStatus("error"));
  }
  return { ws, close() { ws.close(); } };
}

