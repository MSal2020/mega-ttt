import PartySocket from "partysocket";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";

export function createConnection(roomCode, onMessage) {
  const ws = new PartySocket({
    host: PARTYKIT_HOST,
    room: roomCode.toUpperCase(),
  });

  ws.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {}
  });

  return {
    ws,
    send(msg) { ws.send(JSON.stringify(msg)); },
    join(name) { ws.send(JSON.stringify({ type: "join", name })); },
    setConfig(config) { ws.send(JSON.stringify({ type: "config", config })); },
    start() { ws.send(JSON.stringify({ type: "start" })); },
    move(r, c) { ws.send(JSON.stringify({ type: "move", r, c })); },
    powerToggle() { ws.send(JSON.stringify({ type: "power-toggle" })); },
    rematch() { ws.send(JSON.stringify({ type: "rematch" })); },
    close() { ws.close(); },
  };
}
