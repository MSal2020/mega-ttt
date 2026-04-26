import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { PLAYERS, POWERS, getWinConditions, generateRoomCode } from "../lib/gameLogic.js";
import { createConnection, subscribeToLobby } from "./multiplayer.js";
import { useTheme } from "./theme.js";
import { PlayerMark, Collapse } from "./widgets.jsx";
import { HeroShapeGrid, LobbyPresence } from "./screens.jsx";

export function OnlineLobby({ onBack, onGameStart }) {
  const t = useTheme();
  const lobbyDebugEnabled = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("lobbyDebug") === "1") return true;
      return localStorage.getItem("mtt-lobby-debug") === "1";
    } catch {
      return false;
    }
  }, []);
  const [tab, setTab] = useState("menu"); // menu | create | join
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [conn, setConn] = useState(null);
  const [players, setPlayers] = useState([]);
  const [you, setYou] = useState(-1);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [copied, setCopied] = useState(false);
  const [playerName, setPlayerName] = useState(() => { try { return localStorage.getItem("mtt-player-name") || ""; } catch { return ""; } });
  const [lastRoom, setLastRoom] = useState(() => { try { return localStorage.getItem("mtt-last-room") || ""; } catch { return ""; } });
  const [awaitingStartAck, setAwaitingStartAck] = useState(false);
  const awaitingStartAckRef = useRef(false);
  const youRef = useRef(you);

  useEffect(() => { awaitingStartAckRef.current = awaitingStartAck; }, [awaitingStartAck]);
  useEffect(() => { youRef.current = you; }, [you]);

  // Config state (host only)
  const [mode, setMode] = useState("normal");
  const [gridSize, setGridSize] = useState(12);
  const [powers, setPowers] = useState([0, 1, 2, 3]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLineLen, setCustomLineLen] = useState(null);
  const [customLinesNeeded, setCustomLinesNeeded] = useState(null);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(15);
  const [playerCount, setPlayerCount] = useState(2);
  const [teams, setTeamsState] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [publicRooms, setPublicRooms] = useState([]);
  const [lobbyDebugEvents, setLobbyDebugEvents] = useState([]);
  const autoWc = getWinConditions(gridSize, playerCount);
  const wc = {
    lineLen: customLineLen ?? autoWc.lineLen,
    linesNeeded: customLinesNeeded ?? autoWc.linesNeeded,
  };
  const usedPowers = powers.slice(0, playerCount);
  const hasDupes = mode === "powers" && new Set(usedPowers).size < usedPowers.length;

  const connectToRoom = useCallback((code, isHost, asSpectator = false) => {
    setRoomCode(code);
    setStatus("connecting");
    setError(null);

    const connection = createConnection(code, (msg) => {
      switch (msg.type) {
        case "room-state":
          setYou(msg.you);
          setPlayers(msg.players || []);
          setStatus("connected");
          if (msg.phase === "playing" || msg.phase === "review") {
            onGameStart(connection, msg);
          }
          break;
        case "player-joined":
          setPlayers(prev => {
            const idx = prev.findIndex(p => p.slot === msg.slot);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], name: msg.name };
              return next;
            }
            return [...prev, { slot: msg.slot, name: msg.name }];
          });
          break;
        case "player-left":
          setPlayers(prev => prev.filter(p => p.slot !== msg.slot));
          break;
        case "spectator-joined":
        case "spectator-renamed":
          break;
        case "config-updated":
          if (awaitingStartAckRef.current && youRef.current === 0) {
            awaitingStartAckRef.current = false;
            setAwaitingStartAck(false);
            connection.start();
          }
          break;
        case "game-started":
        case "move-applied":
        case "game-over":
          awaitingStartAckRef.current = false;
          setAwaitingStartAck(false);
          onGameStart(connection, msg);
          break;
        case "error":
          awaitingStartAckRef.current = false;
          setAwaitingStartAck(false);
          setError(msg.message);
          connection.close();
          setTimeout(() => setError(null), 3000);
          break;
        default: break;
      }
    });

    // Join once immediately; PartySocket queues this until the socket opens.
    const name = (playerName || "").trim() || (isHost ? "Host" : asSpectator ? "Spectator" : "Guest");
    connection.join(name, { asSpectator });

    connection.ws.addEventListener("open", () => {
      setStatus("connected");
    });
    connection.ws.addEventListener("error", () => {
      setError("Connection failed");
      setStatus("error");
    });
    connection.ws.addEventListener("close", () => {
      setStatus("disconnected");
    });

    setConn(connection);
    return connection;
  }, [onGameStart, playerName]);

  const createRoom = useCallback(() => {
    const code = generateRoomCode();
    setTab("create");
    connectToRoom(code, true);
  }, [connectToRoom]);

  const joinRoom = useCallback(() => {
    if (joinCode.length !== 4) { setError("Enter a 4-character code"); return; }
    setTab("join");
    connectToRoom(joinCode.toUpperCase(), false);
  }, [joinCode, connectToRoom]);

  const startGame = useCallback(() => {
    if (!conn) return;
    if (hasDupes) return;
    const config = {
      mode, gridSize, playerCount,
      powers: powers.slice(0, playerCount),
      ...wc,
      timer: timerEnabled ? timerSeconds : 0,
      ai: false,
      teams: teams && playerCount === 4,
      public: isPublic,
    };
    awaitingStartAckRef.current = true;
    setAwaitingStartAck(true);
    conn.setConfig(config);
  }, [conn, mode, gridSize, powers, wc, timerEnabled, timerSeconds, hasDupes, isPublic, teams, playerCount]);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomCode]);

  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [roomCode]);

  // When a room is created/joined, reflect the code in the URL so the host's
  // browser URL is directly shareable and refresh-safe.
  useEffect(() => {
    if (!roomCode) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") !== roomCode) {
      url.searchParams.set("room", roomCode);
      window.history.replaceState({}, "", url.toString());
    }
  }, [roomCode]);

  // Auto-join from ?room=CODE on first mount
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("room");
    if (code && /^[A-Z0-9]{4}$/i.test(code)) {
      autoJoinedRef.current = true;
      setTab("join");
      setJoinCode(code.toUpperCase());
      connectToRoom(code.toUpperCase(), false);
    }
  }, [connectToRoom]);

  // Note: no cleanup-on-unmount here — when the game starts, the lobby
  // unmounts but the parent takes ownership of the connection via onGameStart.
  // Explicit "Back" button handles closing.

  const isHost = you === 0;
  const isSpectator = you === -1;
  const seatedPlayers = players.filter(p => p.slot >= 0);
  const opponentJoined = seatedPlayers.length >= playerCount;

  // Push config to server when host changes settings (so the join cap matches)
  useEffect(() => {
    if (!conn || !isHost) return;
    const config = {
      mode, gridSize, playerCount,
      powers: powers.slice(0, playerCount),
      ...wc,
      timer: timerEnabled ? timerSeconds : 0,
      ai: false,
      teams: teams && playerCount === 4,
      public: isPublic,
    };
    conn.setConfig(config);
  }, [conn, isHost, mode, gridSize, playerCount, powers, wc.lineLen, wc.linesNeeded, timerEnabled, timerSeconds, isPublic, teams]);

  // Subscribe to public room list while on the browse tab
  useEffect(() => {
    if (tab !== "browse") return;
    setLobbyDebugEvents([]);
    const sub = subscribeToLobby({
      onRooms: setPublicRooms,
      onDebug: lobbyDebugEnabled
        ? (evt) => {
            setLobbyDebugEvents((prev) => {
              const next = [...prev, evt];
              return next.slice(-40);
            });
          }
        : null,
    });
    return () => sub.close();
  }, [tab, lobbyDebugEnabled]);

  const leaveLobby = useCallback(() => {
    if (conn) {
      conn.close();
      setConn(null);
    }
    onBack();
  }, [conn, onBack]);

  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 960);
  useEffect(() => {
    const on = () => setIsWide(window.innerWidth >= 960);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const inRoom = tab === "create" || tab === "join";

  return (
    <>
      <div className="glass-bg" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100dvh", display: "flex", alignItems: isWide ? "center" : "stretch", justifyContent: "center", padding: isWide ? "40px 56px" : 20, userSelect: "none" }}>
      <div style={{
        width: "100%", maxWidth: isWide ? 1200 : 440, minWidth: 0,
        display: "grid", gridTemplateColumns: isWide ? "1.1fr 1fr" : "minmax(0, 1fr)",
        gap: isWide ? 64 : 0, alignItems: "stretch",
        animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)",
        minHeight: isWide ? undefined : "calc(100dvh - 40px)",
      }}>
        {isWide && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28, minHeight: 620 }}>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <button className="btn-hover" onClick={leaveLobby} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
            </div>
            {!inRoom && (
              <div>
                <h1 style={{ fontSize: "clamp(48px, 5.4vw, 72px)", fontWeight: 800, letterSpacing: "-0.045em", color: t.ink, lineHeight: 0.92 }}>Play<br />Online</h1>
                <p style={{ fontSize: 16, color: t.inkMuted, marginTop: 18, maxWidth: 420, lineHeight: 1.5 }}>
                  Match up with friends or jump into a public room. Rooms hold up to four players, each with their own shape signature.
                </p>
              </div>
            )}
            <div style={{ flex: 1, minHeight: 280, position: "relative" }}>
              {inRoom
                ? <LobbyPresence roomCode={roomCode} players={players} you={you} playerCount={playerCount} gridSize={gridSize} mode={mode} teams={teams && playerCount === 4} />
                : <HeroShapeGrid gridSize={gridSize} playerCount={playerCount} mode={mode} />}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: isWide ? "center" : "flex-start", width: "100%", minWidth: 0, maxWidth: isWide ? 460 : "none", marginLeft: isWide ? 0 : "auto", marginRight: isWide ? 0 : "auto" }}>
        {!isWide && (
          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center" }}>
            <button className="btn-hover" onClick={leaveLobby} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: "2px 6px", color: t.inkMuted }}>←</button>
          </div>
        )}
        {!isWide && tab === "menu" && !inRoom && (
          <div style={{ marginTop: 18, marginBottom: 4 }}>
            <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.045em", color: t.ink, lineHeight: 0.92, margin: 0 }}>Play<br />Online</h1>
            <p style={{ fontSize: 14, color: t.inkMuted, marginTop: 10, marginBottom: 0, lineHeight: 1.45 }}>
              Match up with friends or jump into a public room.
            </p>
          </div>
        )}
        {!isWide && tab === "menu" && !inRoom && (
          <div style={{ position: "relative", width: "100%", flex: 1, minHeight: 200, margin: "18px auto 8px", overflow: "hidden", borderRadius: 20 }}>
            <HeroShapeGrid gridSize={7} playerCount={2} mode="normal" />
          </div>
        )}
        {!isWide && (tab !== "menu" || inRoom) && (
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", textAlign: "center", color: t.ink, marginTop: 8, marginBottom: 0 }}>Play Online</h1>
        )}

        {error && (
          <div style={{ marginTop: 16, padding: "8px 14px", borderRadius: 10, background: "rgba(200,84,74,0.12)", border: "0.5px solid rgba(200,84,74,0.3)", color: "#C8544A", fontSize: 13, fontWeight: 500, textAlign: "center", animation: "slideUp 0.2s ease-out" }}>
            {error}
          </div>
        )}

        {tab === "menu" && (
          <div style={{ marginTop: isWide ? 24 : 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Your Name</div>
            <input
              type="text"
              placeholder="Enter your name"
              maxLength={20}
              value={playerName}
              onChange={e => { const v = e.target.value; setPlayerName(v); localStorage.setItem("mtt-player-name", v); }}
              style={{
                width: "100%", padding: isWide ? "10px 14px" : "14px 16px", borderRadius: isWide ? 12 : 14, border: `0.5px solid ${t.hair}`,
                fontSize: isWide ? 15 : 16, fontWeight: 500, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink,
                outline: "none", marginBottom: isWide ? 20 : 14, boxSizing: "border-box",
              }}
            />
            {lastRoom && (
              <button className="btn-hover" onClick={() => { setJoinCode(lastRoom); setTab("join"); connectToRoom(lastRoom, false); }} style={{
                width: "100%", padding: isWide ? 12 : 14, borderRadius: 14, border: "0.5px solid rgba(200,84,74,0.4)", fontSize: isWide ? 14 : 15, fontWeight: 600,
                cursor: "pointer", background: "rgba(200,84,74,0.12)", color: "#C8544A",
                fontFamily: "inherit", marginBottom: 12,
              }}>Resume game {lastRoom}</button>
            )}
            <button className="btn-hover" onClick={createRoom} style={{
              width: "100%", padding: isWide ? 16 : 18, borderRadius: isWide ? 14 : 16, border: `0.5px solid ${t.ink}`, fontSize: isWide ? 15 : 16, fontWeight: 600,
              cursor: "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0",
              fontFamily: "inherit", marginBottom: 12,
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
            }}>Create Room</button>
            <div style={{ fontSize: 12, color: t.inkMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: "0.5px", margin: isWide ? "16px 0" : "14px 0" }}>or join a friend</div>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <input
                type="text"
                placeholder="ABCD"
                maxLength={4}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                style={{
                  flex: 1, minWidth: 0, padding: isWide ? "12px 16px" : "16px 18px", borderRadius: isWide ? 12 : 14, border: `0.5px solid ${t.hair}`,
                  fontSize: isWide ? 18 : 20, fontWeight: 700, textAlign: "center", letterSpacing: 6,
                  fontFamily: "inherit", background: t.glassFillSolid, color: t.ink, outline: "none",
                }}
              />
              <button className="btn-hover" onClick={joinRoom} style={{
                flexShrink: 0, padding: isWide ? "12px 20px" : "14px 22px", borderRadius: isWide ? 12 : 14, border: "none", fontSize: isWide ? 14 : 15, fontWeight: 600,
                cursor: "pointer", background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0", fontFamily: "inherit",
              }}>Join</button>
            </div>
            <button className="btn-hover" onClick={() => setTab("browse")} style={{
              width: "100%", padding: isWide ? 12 : 14, borderRadius: isWide ? 12 : 14, border: `0.5px solid ${t.hair}`, fontSize: isWide ? 13 : 14, fontWeight: 500,
              cursor: "pointer", background: t.glassFillSolid, color: t.inkMuted, fontFamily: "inherit", marginTop: isWide ? 16 : 14,
            }}>Browse public rooms</button>
          </div>
        )}

        {tab === "browse" && (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
              Public rooms ({publicRooms.length})
            </div>
            {publicRooms.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", color: t.inkMuted, fontSize: 13, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12 }}>
                No public rooms right now.<br />
                <span style={{ fontSize: 11 }}>Create one and mark it public to share.</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {publicRooms.map(r => {
                  const phase = r.phase || "lobby";
                  const inLobby = phase === "lobby";
                  const full = inLobby && r.players >= r.playerCount;
                  const canJoin = inLobby && !full;
                  const tagPieces = [
                    `${r.players}/${r.playerCount}`,
                    `${r.gridSize}×${r.gridSize}`,
                    r.mode === "powers" ? "powers" : null,
                    r.teams ? "teams" : null,
                    !inLobby ? phase : null,
                    r.spectators > 0 ? `${r.spectators} watching` : null,
                  ].filter(Boolean);
                  return (
                    <div key={r.code} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.ink, letterSpacing: 2 }}>{r.code}</div>
                        <div style={{ fontSize: 11, color: t.inkMuted, marginTop: 2 }}>
                          {r.hostName || "Host"} · {tagPieces.join(" · ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn-hover" disabled={!canJoin} onClick={() => { if (!canJoin) return; setJoinCode(r.code); setTab("join"); connectToRoom(r.code, false, false); }} style={{
                          padding: "6px 12px", borderRadius: 10, border: `0.5px solid ${canJoin ? t.ink : t.hair}`, fontSize: 13, fontWeight: 600,
                          cursor: canJoin ? "pointer" : "not-allowed",
                          background: canJoin ? t.ink : "transparent",
                          color: canJoin ? (t.mode === "dark" ? t.bg1 : "#FAF7F0") : t.inkFaint,
                          fontFamily: "inherit",
                          opacity: canJoin ? 1 : 0.55,
                          transition: "all 0.15s",
                        }}>{full ? "Full" : "Join"}</button>
                        <button className="btn-hover" onClick={() => { setJoinCode(r.code); setTab("join"); connectToRoom(r.code, false, true); }} style={{
                          padding: "6px 12px", borderRadius: 10, border: `0.5px solid ${t.hairStrong}`, fontSize: 13, fontWeight: 500,
                          cursor: "pointer",
                          background: t.glassFill, color: t.ink,
                          fontFamily: "inherit",
                          backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                        }}>Spectate</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn-hover" onClick={() => setTab("menu")} style={{
              width: "100%", padding: 10, borderRadius: 12, border: `0.5px solid ${t.hair}`, fontSize: 13,
              cursor: "pointer", background: t.glassFillSolid, color: t.inkMuted, fontFamily: "inherit", marginTop: 14,
            }}>Back</button>
            {lobbyDebugEnabled && (
              <div style={{
                marginTop: 12,
                borderRadius: 10,
                border: `1px solid ${t.border}`,
                background: t.surface,
                padding: 10,
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.textLabel, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Lobby debug
                  </div>
                  <button className="btn-hover" onClick={() => setLobbyDebugEvents([])} style={{
                    border: "none",
                    background: "transparent",
                    color: t.textMuted,
                    cursor: "pointer",
                    fontSize: 11,
                    padding: 0,
                    fontFamily: "inherit",
                  }}>clear</button>
                </div>
                <div style={{ maxHeight: 130, overflowY: "auto", fontFamily: "monospace", fontSize: 11, lineHeight: 1.35, color: t.textMuted }}>
                  {lobbyDebugEvents.length === 0 ? (
                    <div>No events yet</div>
                  ) : lobbyDebugEvents.map((e, i) => {
                    const tm = new Date(e.at || Date.now()).toLocaleTimeString();
                    const details = [
                      e.event,
                      e.source ? `src=${e.source}` : "",
                      e.code ? `code=${e.code}` : "",
                      typeof e.afterCount === "number" ? `rooms=${e.afterCount}` : (typeof e.roomCount === "number" ? `rooms=${e.roomCount}` : ""),
                      typeof e.players === "number" ? `players=${e.players}` : "",
                      Array.isArray(e.pruned) && e.pruned.length ? `pruned=${e.pruned.length}` : "",
                    ].filter(Boolean).join(" ");
                    return <div key={`${e.at || 0}-${i}`}>[{tm}] {details}</div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {(tab === "create" || tab === "join") && (
          <div style={{ marginTop: 24 }}>
            {status === "connecting" && (
              <div style={{
                padding: "8px 14px", borderRadius: 12, marginBottom: 16,
                display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: t.inkMuted,
                background: t.glassFillSolid, border: `0.5px solid ${t.hair}`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: t.ink, animation: "pulse 1.5s infinite" }} />
                Connecting to room...
              </div>
            )}
            {/* Room code display — full block on narrow, compact share row on wide */}
            {!isWide ? (
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Room Code</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: 8, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{roomCode}</span>
                  <button className="btn-hover" onClick={copyCode} style={{
                    background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 10,
                    padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.inkMuted, fontFamily: "inherit",
                  }}>{copied ? "Copied!" : "Copy"}</button>
                  <button className="btn-hover" onClick={copyLink} style={{
                    background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 10,
                    padding: "6px 10px", fontSize: 12, cursor: "pointer", color: t.inkMuted, fontFamily: "inherit",
                  }}>{linkCopied ? "Link copied!" : "Share link"}</button>
                </div>
                {isHost && (
                  <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, color: t.inkMuted }}>List publicly</span>
                    <button onClick={() => setIsPublic(v => !v)} style={{
                      width: 36, height: 20, borderRadius: 10, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                      background: isPublic ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", background: isPublic ? t.bg1 : t.ink, position: "absolute", top: 1,
                        left: isPublic ? 17 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                      }} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-hover" onClick={copyCode} style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
                    background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                    fontSize: 13, fontWeight: 500, color: t.ink, cursor: "pointer", fontFamily: "inherit",
                  }}>{copied ? "Code copied" : "Copy code"}</button>
                  <button className="btn-hover" onClick={copyLink} style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: `0.5px solid ${t.hairStrong}`,
                    background: t.glassFill, backdropFilter: "blur(14px) saturate(180%)", WebkitBackdropFilter: "blur(14px) saturate(180%)",
                    fontSize: 13, fontWeight: 500, color: t.ink, cursor: "pointer", fontFamily: "inherit",
                  }}>{linkCopied ? "Link copied" : "Share link"}</button>
                </div>
                {isHost && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}` }}>
                    <span style={{ fontSize: 13, color: t.ink }}>List publicly</span>
                    <button onClick={() => setIsPublic(v => !v)} style={{
                      width: 36, height: 20, borderRadius: 10, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                      background: isPublic ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", background: isPublic ? t.bg1 : t.ink, position: "absolute", top: 1,
                        left: isPublic ? 17 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                      }} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Players — hidden on wide (already in hero presence) */}
            {!isWide && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Players</div>
                {Array.from({ length: playerCount }, (_, slot) => slot).map(slot => {
                  const p = players.find(p => p.slot === slot);
                  return (
                    <div key={slot} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      borderRadius: 12, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, marginBottom: 4,
                      transition: "background 0.2s",
                    }}>
                      {p ? <PlayerMark player={PLAYERS[slot]} size={16} /> : (
                        <div style={{ width: 14, height: 14, borderRadius: "50%", border: `1px dashed ${t.hair}` }} />
                      )}
                      <span style={{ fontSize: 14, fontWeight: 500, flex: 1, color: p ? t.ink : t.inkFaint }}>
                        {p ? `${p.name}${slot === you ? " (you)" : ""}` : "Waiting..."}
                      </span>
                      {p && slot === 0 && <span style={{ fontSize: 11, color: t.ink, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: t.inkGhost, border: `0.5px solid ${t.hair}`, letterSpacing: "0.5px" }}>HOST</span>}
                      {!p && (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.inkFaint, animation: "pulse 1.5s infinite" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Host: game config + start button */}
            {isHost && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Mode</div>
                  <div style={{ display: "flex", background: t.inkGhost, borderRadius: 12, padding: 3, gap: 2, border: `0.5px solid ${t.hair}` }}>
                    {["normal", "powers"].map(m => (
                      <button key={m} onClick={() => setMode(m)} style={{
                        flex: 1, padding: "8px 0", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 500,
                        cursor: "pointer", transition: "all 0.2s", fontFamily: "inherit",
                        background: mode === m ? t.glassFillSolid : "transparent",
                        color: mode === m ? t.ink : t.inkMuted,
                        boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                      }}>{m === "normal" ? "Normal" : "Powers"}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Grid size</div>
                    <span style={{ fontSize: 18, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{gridSize}×{gridSize}</span>
                  </div>
                  <input type="range" min={7} max={20} value={gridSize} onChange={e => setGridSize(+e.target.value)} style={{ width: "100%", marginTop: 6, cursor: "pointer" }} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Players</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {[2, 3, 4].map(n => {
                      // Can't shrink below currently-joined count
                      const disabled = n < seatedPlayers.length;
                      return (
                        <button key={n} disabled={disabled} onClick={() => setPlayerCount(n)} style={{
                          width: 44, height: 44, borderRadius: 12, fontSize: 16, fontWeight: 600,
                          cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.15s", opacity: disabled ? 0.35 : 1,
                          border: playerCount === n ? `0.5px solid ${t.hairStrong}` : `0.5px solid ${t.hair}`,
                          background: playerCount === n ? t.inkGhost : t.glassFillSolid,
                          color: playerCount === n ? t.ink : t.inkMuted,
                        }}>{n}</button>
                      );
                    })}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} style={{
                          display: "flex",
                          transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s",
                          transform: i < playerCount ? "scale(1)" : "scale(0)",
                          opacity: i < playerCount ? 1 : 0,
                        }}>
                          <PlayerMark player={PLAYERS[i]} size={16} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {playerCount === 4 && (
                  <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Team mode</div>
                      <div style={{ fontSize: 13, color: t.inkMuted, marginTop: 2 }}>{teams ? "Circle + Square vs Triangle + Diamond" : "Free-for-all"}</div>
                    </div>
                    <button onClick={() => setTeamsState(v => !v)} style={{
                      width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                      background: teams ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%", background: teams ? t.bg1 : t.ink, position: "absolute", top: 1,
                        left: teams ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                      }} />
                    </button>
                  </div>
                )}

                <Collapse open={mode === "powers"} maxH={260}>
                  <div style={{ marginBottom: 16, paddingBottom: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Assign powers</div>
                    {Array.from({ length: playerCount }).map((_, pi) => (
                      <div key={pi} style={{ display: "flex", alignItems: "center", gap: 10, background: t.glassFillSolid, borderRadius: 12, padding: "8px 12px", marginBottom: 6, border: `0.5px solid ${t.hair}` }}>
                        <PlayerMark player={PLAYERS[pi]} size={16} />
                        <span style={{ fontSize: 13, fontWeight: 500, width: 60, flexShrink: 0, color: t.ink }}>{PLAYERS[pi].name}</span>
                        <select value={powers[pi]} onChange={e => { const p = [...powers]; p[pi] = +e.target.value; setPowers(p); }}
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 10, border: `0.5px solid ${t.hair}`, fontSize: 13, fontFamily: "inherit", background: t.glassFillSolid, color: t.ink }}>
                          {POWERS.map((pw, wi) => <option key={wi} value={wi}>{pw.icon} {pw.name}</option>)}
                        </select>
                      </div>
                    ))}
                    {hasDupes && <p style={{ fontSize: 12, color: "#C8544A", marginTop: 4 }}>Each player should have a unique power</p>}
                  </div>
                </Collapse>

                <div style={{ marginBottom: 4, background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, color: t.inkMuted, fontWeight: 500, marginBottom: 4 }}>Win condition</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.ink }}>
                    {wc.lineLen} in a row{wc.linesNeeded > 1 ? `, ${wc.linesNeeded} times` : ""}
                    {(customLineLen !== null || customLinesNeeded !== null) && <span style={{ fontSize: 11, color: t.ink, marginLeft: 6, padding: "2px 6px", borderRadius: 6, background: t.inkGhost, border: `0.5px solid ${t.hair}` }}>custom</span>}
                  </div>
                </div>

                <button onClick={() => setShowAdvanced(v => !v)} style={{
                  width: "100%", padding: "10px 0", border: "none", background: "none",
                  fontSize: 13, color: t.inkMuted, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}>
                  <span style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>▸</span>
                  Advanced settings
                </button>

                <Collapse open={showAdvanced} maxH={400}>
                  <div style={{ background: t.glassFillSolid, border: `0.5px solid ${t.hair}`, borderRadius: 12, padding: "14px", marginTop: 4, marginBottom: 16 }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Line length</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{wc.lineLen}{customLineLen !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
                      </div>
                      <input type="range" min={3} max={Math.min(gridSize, 8)} value={wc.lineLen}
                        onChange={e => { const v = +e.target.value; setCustomLineLen(v === autoWc.lineLen ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Lines to win</div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{wc.linesNeeded}{customLinesNeeded !== null && <span style={{ fontSize: 10, marginLeft: 4, padding: "1px 5px", borderRadius: 5, background: t.inkGhost, border: `0.5px solid ${t.hair}`, fontWeight: 500 }}>custom</span>}</span>
                      </div>
                      <input type="range" min={1} max={5} value={wc.linesNeeded}
                        onChange={e => { const v = +e.target.value; setCustomLinesNeeded(v === autoWc.linesNeeded ? null : v); }}
                        style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: t.inkMuted, letterSpacing: "0.5px", textTransform: "uppercase" }}>Turn timer</div>
                        <button onClick={() => setTimerEnabled(v => !v)} style={{
                          width: 40, height: 22, borderRadius: 11, border: `0.5px solid ${t.hair}`, cursor: "pointer",
                          background: timerEnabled ? t.ink : t.glassFillSolid, position: "relative", transition: "background 0.2s",
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: "50%", background: timerEnabled ? t.bg1 : t.ink, position: "absolute", top: 1,
                            left: timerEnabled ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
                          }} />
                        </button>
                      </div>
                      <Collapse open={timerEnabled} maxH={120}>
                        <div style={{ paddingBottom: 2 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: t.inkMuted }}>Seconds per turn</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums" }}>{timerSeconds}s</span>
                          </div>
                          <input type="range" min={5} max={60} step={5} value={timerSeconds}
                            onChange={e => setTimerSeconds(+e.target.value)}
                            style={{ width: "100%", cursor: "pointer" }} />
                        </div>
                      </Collapse>
                    </div>
                    {(customLineLen !== null || customLinesNeeded !== null) && (
                      <button className="btn-hover" onClick={() => { setCustomLineLen(null); setCustomLinesNeeded(null); }} style={{
                        width: "100%", padding: 8, borderRadius: 10, border: `0.5px solid ${t.hair}`,
                        background: t.glassFillSolid, fontSize: 12, color: t.inkMuted, cursor: "pointer",
                        fontFamily: "inherit", marginTop: 10,
                      }}>Reset to default</button>
                    )}
                  </div>
                </Collapse>

                <button className="btn-hover" onClick={startGame} disabled={!opponentJoined || hasDupes} style={{
                  width: "100%", padding: 14, borderRadius: 14, border: `0.5px solid ${t.ink}`, fontSize: 15, fontWeight: 600,
                  cursor: (opponentJoined && !hasDupes) ? "pointer" : "default",
                  background: t.ink, color: t.mode === "dark" ? t.bg1 : "#FAF7F0",
                  fontFamily: "inherit", opacity: (opponentJoined && !hasDupes) ? 1 : 0.4,
                  boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                  transition: "opacity 0.15s",
                }}>
                  {opponentJoined ? "Start Game" : "Waiting for opponent..."}
                </button>
              </>
            )}

            {/* Guest / spectator: waiting for host to start */}
            {!isHost && status === "connected" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 14, color: t.inkMuted }}>
                  {isSpectator
                    ? (opponentJoined ? "Watching — game starts when host begins." : "Watching this room — waiting for players…")
                    : (opponentJoined ? "Waiting for host to start..." : "Connecting...")}
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: "50%", background: t.ink,
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      </div>
    </>
  );
}
