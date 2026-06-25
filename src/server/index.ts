import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import {
  addOrReconnectPlayer,
  applyPlayerAction,
  createRoom,
  generateRoomCode,
  getPlayerSnapshot,
  getRoomSnapshot,
  PokerError,
  setPlayerConnected,
  startHand,
  type Room,
} from "./poker";
import { type JoinRoomPayload, type PlayerActionPayload, type SocketAck } from "../shared/types";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const rooms = new Map<string, Room>();
const playerSockets = new Map<string, Set<string>>();
const socketPlayers = new Map<string, { roomCode: string; playerId: string }>();

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.path.startsWith("/socket.io")) {
      next();
      return;
    }
    response.sendFile(path.join(distPath, "index.html"));
  });
}

io.on("connection", (socket) => {
  socket.on("createRoom", (ack: (response: SocketAck<{ roomCode: string }>) => void) => {
    respond(ack, () => {
      const roomCode = generateRoomCode(new Set(rooms.keys()));
      const room = createRoom(roomCode, socketOrigin(socket));
      rooms.set(roomCode, room);
      socket.join(roomChannel(roomCode));
      emitRoom(roomCode);
      return { roomCode };
    });
  });

  socket.on("watchRoom", (roomCode: string, ack: (response: SocketAck<{ roomCode: string }>) => void) => {
    respond(ack, () => {
      const room = getRoom(roomCode);
      room.joinOrigin = socketOrigin(socket);
      socket.join(roomChannel(room.roomCode));
      emitRoom(room.roomCode);
      return { roomCode: room.roomCode };
    });
  });

  socket.on("joinRoom", (payload: JoinRoomPayload, ack: (response: SocketAck<{ roomCode: string; playerId: string }>) => void) => {
    respond(ack, () => {
      const room = getRoom(payload.roomCode);
      room.joinOrigin = socketOrigin(socket);
      const player = addOrReconnectPlayer(room, payload.name, payload.playerId);
      registerPlayerSocket(socket, room.roomCode, player.id);
      socket.join(roomChannel(room.roomCode));
      emitRoom(room.roomCode);
      return { roomCode: room.roomCode, playerId: player.id };
    });
  });

  socket.on("startHand", (roomCode: string, ack?: (response: SocketAck) => void) => {
    respond(ack, () => {
      const room = getRoom(roomCode);
      startHand(room);
      emitRoom(room.roomCode);
      return {};
    });
  });

  socket.on("playerAction", (payload: PlayerActionPayload, ack?: (response: SocketAck) => void) => {
    respond(ack, () => {
      const room = getRoom(payload.roomCode);
      applyPlayerAction(room, payload);
      emitRoom(room.roomCode);
      return {};
    });
  });

  socket.on("disconnect", () => {
    const registration = socketPlayers.get(socket.id);
    if (!registration) {
      return;
    }

    socketPlayers.delete(socket.id);
    const sockets = playerSockets.get(registration.playerId);
    sockets?.delete(socket.id);

    if (!sockets || sockets.size === 0) {
      playerSockets.delete(registration.playerId);
      const room = rooms.get(registration.roomCode);
      if (room) {
        setPlayerConnected(room, registration.playerId, false);
        emitRoom(room.roomCode);
      }
    }
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Poker room server listening on http://localhost:${PORT}`);
});

function getRoom(roomCode: string): Room {
  const normalizedCode = normalizeRoomCode(roomCode);
  const room = rooms.get(normalizedCode);
  if (!room) {
    throw new PokerError("Room not found.");
  }
  return room;
}

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

function registerPlayerSocket(socket: Socket, roomCode: string, playerId: string): void {
  const previousRegistration = socketPlayers.get(socket.id);
  if (previousRegistration) {
    playerSockets.get(previousRegistration.playerId)?.delete(socket.id);
  }

  socketPlayers.set(socket.id, { roomCode, playerId });
  const sockets = playerSockets.get(playerId) ?? new Set<string>();
  sockets.add(socket.id);
  playerSockets.set(playerId, sockets);
}

function emitRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }

  io.to(roomChannel(roomCode)).emit("room:update", getRoomSnapshot(room));

  for (const player of room.players) {
    const sockets = playerSockets.get(player.id);
    if (!sockets) {
      continue;
    }

    for (const socketId of sockets) {
      io.to(socketId).emit("player:update", getPlayerSnapshot(room, player.id));
    }
  }
}

function roomChannel(roomCode: string): string {
  return `room:${roomCode}`;
}

function socketOrigin(socket: Socket): string {
  const origin = socket.handshake.headers.origin;
  if (origin) {
    return origin;
  }
  const host = socket.handshake.headers.host ?? `localhost:${PORT}`;
  return `http://${host}`;
}

function respond<T>(ack: ((response: SocketAck<T>) => void) | undefined, action: () => T): void {
  try {
    ack?.({ ok: true, data: action() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    ack?.({ ok: false, error: message });
  }
}
