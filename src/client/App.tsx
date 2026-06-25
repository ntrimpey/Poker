import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  type AvailableActions,
  type Card,
  type PlayerActionType,
  type PlayerSnapshot,
  type PublicPlayer,
  type RoomSnapshot,
  type SocketAck,
} from "../shared/types";

interface AppProps {
  socket: Socket;
}

const PLAYER_KEY_PREFIX = "poker-player";

export default function App({ socket }: AppProps) {
  const initialRoomCode = new URLSearchParams(window.location.search).get("room") ?? "";
  const initialTvCode = new URLSearchParams(window.location.search).get("tv") ?? "";
  const [mode, setMode] = useState<"home" | "tv" | "player">(initialTvCode ? "tv" : "home");
  const [roomCode, setRoomCode] = useState(initialRoomCode || initialTvCode);
  const [playerName, setPlayerName] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [player, setPlayer] = useState<PlayerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const onRoomUpdate = (snapshot: RoomSnapshot) => setRoom(snapshot);
    const onPlayerUpdate = (snapshot: PlayerSnapshot) => {
      setPlayer(snapshot);
      setRoom(snapshot);
    };

    socket.on("room:update", onRoomUpdate);
    socket.on("player:update", onPlayerUpdate);
    return () => {
      socket.off("room:update", onRoomUpdate);
      socket.off("player:update", onPlayerUpdate);
    };
  }, [socket]);

  useEffect(() => {
    if (!initialTvCode) {
      return;
    }

    void watchRoom(initialTvCode);
    // The initial query string should only be consumed on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialRoomCode) {
      return;
    }

    const storedPlayer = getStoredPlayer(initialRoomCode);
    if (storedPlayer) {
      setPlayerName(storedPlayer.name);
      void joinRoom(initialRoomCode, storedPlayer.name, storedPlayer.playerId);
    }
    // The initial query string should only be consumed on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createRoom() {
    setIsBusy(true);
    setError(null);
    try {
      const response = await emitAck<{ roomCode: string }>(socket, "createRoom");
      if (!response.ok) throw new Error(response.error);
      setRoomCode(response.data.roomCode);
      setMode("tv");
      window.history.replaceState(null, "", `?tv=${response.data.roomCode}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  async function watchRoom(code = roomCode) {
    setIsBusy(true);
    setError(null);
    try {
      const normalizedCode = code.trim().toUpperCase();
      const response = await emitAck<{ roomCode: string }>(socket, "watchRoom", normalizedCode);
      if (!response.ok) throw new Error(response.error);
      setRoomCode(response.data.roomCode);
      setMode("tv");
      window.history.replaceState(null, "", `?tv=${response.data.roomCode}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  async function joinRoom(code = roomCode, name = playerName, playerId?: string) {
    setIsBusy(true);
    setError(null);
    try {
      const normalizedCode = code.trim().toUpperCase();
      const response = await emitAck<{ roomCode: string; playerId: string }>(socket, "joinRoom", {
        roomCode: normalizedCode,
        name,
        playerId,
      });
      if (!response.ok) throw new Error(response.error);
      setRoomCode(response.data.roomCode);
      setPlayerName(name.trim());
      setMode("player");
      storePlayer(response.data.roomCode, response.data.playerId, name.trim());
      window.history.replaceState(null, "", `?room=${response.data.roomCode}`);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  async function startHand() {
    if (!room) return;
    await command("startHand", room.roomCode);
  }

  async function playerAction(type: PlayerActionType, amount?: number) {
    if (!player) return;
    await command("playerAction", {
      roomCode: player.roomCode,
      playerId: player.playerId,
      type,
      amount,
    });
  }

  async function command(event: string, payload: unknown) {
    setIsBusy(true);
    setError(null);
    try {
      const response = await emitAck(socket, event, payload);
      if (!response.ok) throw new Error(response.error);
    } catch (caughtError) {
      setError(toErrorMessage(caughtError));
    } finally {
      setIsBusy(false);
    }
  }

  const content = useMemo(() => {
    if (mode === "tv" && room) {
      return <TvTable room={room} isBusy={isBusy} onStartHand={startHand} />;
    }

    if (mode === "player" && player) {
      return <PlayerController player={player} isBusy={isBusy} onAction={playerAction} />;
    }

    return (
      <Home
        roomCode={roomCode}
        playerName={playerName}
        isBusy={isBusy}
        onRoomCodeChange={setRoomCode}
        onPlayerNameChange={setPlayerName}
        onCreateRoom={createRoom}
        onJoinRoom={() => joinRoom()}
        onWatchRoom={() => watchRoom()}
      />
    );
  }, [isBusy, mode, player, playerName, room, roomCode]);

  return (
    <main className="app-shell">
      {error && (
        <button className="error-banner" type="button" onClick={() => setError(null)}>
          {error}
        </button>
      )}
      {content}
    </main>
  );
}

interface HomeProps {
  roomCode: string;
  playerName: string;
  isBusy: boolean;
  onRoomCodeChange: (roomCode: string) => void;
  onPlayerNameChange: (playerName: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onWatchRoom: () => void;
}

function Home({
  roomCode,
  playerName,
  isBusy,
  onRoomCodeChange,
  onPlayerNameChange,
  onCreateRoom,
  onJoinRoom,
  onWatchRoom,
}: HomeProps) {
  return (
    <section className="home-grid">
      <div className="hero-card">
        <p className="eyebrow">Texas Hold'em night</p>
        <h1>Phones are controllers. The TV is the table.</h1>
        <p>
          Create a room on the big screen, then players join from their phones with the room code to
          receive private hole cards and make betting decisions.
        </p>
        <button className="primary-action" type="button" disabled={isBusy} onClick={onCreateRoom}>
          Host a TV table
        </button>
      </div>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          onJoinRoom();
        }}
      >
        <h2>Join from a phone</h2>
        <label>
          Room code
          <input
            value={roomCode}
            maxLength={5}
            placeholder="A7KQ2"
            onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
          />
        </label>
        <label>
          Your name
          <input
            value={playerName}
            maxLength={20}
            placeholder="Maverick"
            onChange={(event) => onPlayerNameChange(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isBusy || !roomCode.trim() || !playerName.trim()}>
          Join game
        </button>
      </form>

      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          onWatchRoom();
        }}
      >
        <h2>Open an existing TV table</h2>
        <label>
          Room code
          <input
            value={roomCode}
            maxLength={5}
            placeholder="A7KQ2"
            onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
          />
        </label>
        <button type="submit" disabled={isBusy || !roomCode.trim()}>
          Watch table
        </button>
      </form>
    </section>
  );
}

function TvTable({
  room,
  isBusy,
  onStartHand,
}: {
  room: RoomSnapshot;
  isBusy: boolean;
  onStartHand: () => void;
}) {
  return (
    <section className="tv-layout">
      <header className="tv-header">
        <div>
          <p className="eyebrow">Room code</p>
          <h1 className="room-code">{room.roomCode}</h1>
        </div>
        <div className="join-card">
          <span>Join on phone</span>
          <strong>{room.joinUrl}</strong>
        </div>
        <button type="button" disabled={isBusy || !room.canStart} onClick={onStartHand}>
          {room.phase === "handOver" ? "Deal next hand" : "Start hand"}
        </button>
      </header>

      <div className="table-felt">
        <div className="score-strip">
          <Stat label="Hand" value={room.handNumber || "-"} />
          <Stat label="Phase" value={phaseLabel(room.phase)} />
          <Stat label="Pot" value={room.pot} />
          <Stat label="Current bet" value={room.currentBet} />
        </div>

        <div className="community">
          {Array.from({ length: 5 }).map((_, index) => (
            <CardView key={index} card={room.communityCards[index]} />
          ))}
        </div>

        {room.winnerMessage && <div className="winner-banner">{room.winnerMessage}</div>}

        <div className="player-ring">
          {room.players.length === 0 ? (
            <p className="empty-state">Waiting for players to join with room code {room.roomCode}.</p>
          ) : (
            room.players.map((player) => <SeatCard key={player.id} player={player} isTurn={player.seat === room.turnSeat} />)
          )}
        </div>
      </div>

      <ActionLog actions={room.actionLog} />
    </section>
  );
}

function PlayerController({
  player,
  isBusy,
  onAction,
}: {
  player: PlayerSnapshot;
  isBusy: boolean;
  onAction: (type: PlayerActionType, amount?: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const actions = player.availableActions;
  const me = player.players.find((candidate) => candidate.id === player.playerId);
  const suggestedAmount = actions.minBet || actions.minRaiseTo || actions.maxBet;

  useEffect(() => {
    if (suggestedAmount) {
      setAmount(String(suggestedAmount));
    }
  }, [suggestedAmount]);

  return (
    <section className="phone-layout">
      <header className="phone-header">
        <div>
          <p className="eyebrow">Room {player.roomCode}</p>
          <h1>{me?.name ?? "Player"}</h1>
        </div>
        <div className="stack-pill">Stack {me?.stack ?? 0}</div>
      </header>

      <div className="hole-cards">
        <CardView card={player.holeCards[0]} />
        <CardView card={player.holeCards[1]} />
      </div>

      <div className="mini-table">
        <Stat label="Phase" value={phaseLabel(player.phase)} />
        <Stat label="Pot" value={player.pot} />
        <Stat label="To call" value={actions.callAmount} />
      </div>

      {player.winnerMessage && <div className="winner-banner">{player.winnerMessage}</div>}

      <div className="control-panel">
        {actions.isPlayersTurn ? (
          <>
            <p className="turn-copy">Your action</p>
            <div className="button-grid">
              <button type="button" disabled={isBusy || !actions.canFold} onClick={() => onAction("fold")}>
                Fold
              </button>
              <button type="button" disabled={isBusy || !actions.canCheck} onClick={() => onAction("check")}>
                Check
              </button>
              <button type="button" disabled={isBusy || !actions.canCall} onClick={() => onAction("call")}>
                Call {actions.callAmount}
              </button>
              <button type="button" disabled={isBusy} onClick={() => onAction("all-in")}>
                All-in
              </button>
            </div>
            <label>
              {player.currentBet === 0 ? "Bet amount" : "Raise to"}
              <input
                inputMode="numeric"
                value={amount}
                min={player.currentBet === 0 ? actions.minBet : actions.minRaiseTo}
                max={actions.maxBet}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <button
              className="primary-action"
              type="button"
              disabled={isBusy || !amount}
              onClick={() => onAction(player.currentBet === 0 ? "bet" : "raise", Number(amount))}
            >
              {player.currentBet === 0 ? "Bet" : "Raise"}
            </button>
          </>
        ) : (
          <p className="waiting-copy">
            {player.phase === "lobby" || player.phase === "handOver"
              ? "Waiting for the TV to deal the next hand."
              : `Waiting for seat ${player.turnSeat ?? "-"} to act.`}
          </p>
        )}
      </div>

      <div className="community compact">
        {Array.from({ length: 5 }).map((_, index) => (
          <CardView key={index} card={player.communityCards[index]} />
        ))}
      </div>

      <ActionLog actions={player.actionLog.slice(0, 5)} />
    </section>
  );
}

function SeatCard({ player, isTurn }: { player: PublicPlayer; isTurn: boolean }) {
  return (
    <article className={`seat-card ${isTurn ? "is-turn" : ""} ${!player.connected ? "is-offline" : ""}`}>
      <div className="seat-topline">
        <strong>{player.name}</strong>
        <span>Seat {player.seat}</span>
      </div>
      <div className="badges">
        {player.isDealer && <span>D</span>}
        {player.isSmallBlind && <span>SB</span>}
        {player.isBigBlind && <span>BB</span>}
        {player.folded && <span>Fold</span>}
        {player.allIn && <span>All-in</span>}
        {!player.connected && <span>Offline</span>}
      </div>
      <div className="seat-cards">
        {Array.from({ length: Math.max(2, player.cardCount) }).map((_, index) => (
          <CardView key={index} card={player.cards?.[index]} faceDown={!player.cards?.[index]} small />
        ))}
      </div>
      <div className="seat-money">
        <span>Stack {player.stack}</span>
        <span>Bet {player.bet}</span>
      </div>
    </article>
  );
}

function CardView({ card, faceDown = false, small = false }: { card?: Card; faceDown?: boolean; small?: boolean }) {
  if (!card || faceDown) {
    return <div className={`card back ${small ? "small" : ""}`}>POK</div>;
  }

  const suitName = toTitleCase(card.suit);
  return (
    <div className={`card ${card.suit} ${small ? "small" : ""}`} aria-label={`${card.rank} of ${suitName}`}>
      <span className="card-rank">{card.rank}</span>
      <strong className="card-suit">{suitName}</strong>
    </div>
  );
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ActionLog({ actions }: { actions: RoomSnapshot["actionLog"] }) {
  return (
    <aside className="action-log">
      <h2>Betting action</h2>
      {actions.length === 0 ? (
        <p className="empty-state">No action yet.</p>
      ) : (
        <ol>
          {actions.map((action) => (
            <li key={action.id}>
              <strong>{action.actor}</strong> {action.message}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function phaseLabel(phase: RoomSnapshot["phase"]): string {
  if (phase === "handOver") return "Hand over";
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function emitAck<T = unknown>(socket: Socket, event: string, payload?: unknown): Promise<SocketAck<T>> {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(event, resolve);
    } else {
      socket.emit(event, payload, resolve);
    }
  });
}

function storePlayer(roomCode: string, playerId: string, name: string): void {
  localStorage.setItem(`${PLAYER_KEY_PREFIX}:${roomCode}`, JSON.stringify({ playerId, name }));
}

function getStoredPlayer(roomCode: string): { playerId: string; name: string } | null {
  const rawValue = localStorage.getItem(`${PLAYER_KEY_PREFIX}:${roomCode.toUpperCase()}`);
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue) as { playerId: string; name: string };
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
