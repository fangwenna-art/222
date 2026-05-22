import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameEngine } from './gameEngine.js';

const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../../client');
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5188')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_LAN = process.env.ALLOW_LAN !== 'false';

function isPrivateHost(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)) return true;
  return false;
}

function isAllowedPublicTunnel(hostname) {
  return hostname.endsWith('.lhr.life') || hostname.endsWith('.loca.lt');
}

function corsOrigin(origin, callback) {
  if (!origin || CLIENT_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    if ((protocol === 'http:' || protocol === 'https:') && (isAllowedPublicTunnel(hostname) || (ALLOW_LAN && isPrivateHost(hostname)))) {
      callback(null, true);
      return;
    }
  } catch {
    /* ignore */
  }
  callback(new Error('Not allowed by CORS'));
}

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.static(CLIENT_DIR));
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

/** @type {Map<string, { id: string, players: Map<string, { id: string, name: string, token: string, socketId: string | null, online: boolean }>, engine: GameEngine | null }>} */
const rooms = new Map();
const tokenIndex = new Map();

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: new Map(),
    engine: null,
  };
}

function createPlayer(name) {
  return {
    id: randomUUID(),
    token: randomUUID(),
    name,
    socketId: null,
    online: true,
  };
}

function attachPlayerToSocket(socket, roomId, player) {
  if (socket.data.roomId && socket.data.playerId && socket.data.playerId !== player.id) {
    const previousRoom = rooms.get(socket.data.roomId);
    const previousPlayer = previousRoom?.players.get(socket.data.playerId);
    if (previousPlayer?.socketId === socket.id) {
      previousPlayer.socketId = null;
      previousPlayer.online = false;
    }
  }

  if (player.socketId && player.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(player.socketId);
    oldSocket?.leave(roomId);
    oldSocket?.disconnect(true);
  }

  player.socketId = socket.id;
  player.online = true;
  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.playerId = player.id;
  socket.data.playerName = player.name;
}

function buildSession(player, roomId) {
  return {
    roomId,
    playerId: player.id,
    token: player.token,
    playerName: player.name,
  };
}

function getRoomAndPlayer(socket) {
  const roomId = socket.data.roomId;
  const playerId = socket.data.playerId;
  if (!roomId || !playerId) return { roomId: null, room: null, player: null };
  const room = rooms.get(roomId);
  const player = room?.players.get(playerId) ?? null;
  return { roomId, room, player };
}

function buildGameState(room, viewerPlayerId) {
  if (room.engine) {
    room.engine.onlineStatus = Object.fromEntries(
      Array.from(room.players.values()).map((p) => [p.id, p.online]),
    );
  }

  return {
    roomId: room.id,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      online: p.online,
    })),
    hand: room.engine ? room.engine.toPublicState(viewerPlayerId) : null,
  };
}

function emitGameStateToPlayer(room, player) {
  if (!player.online || !player.socketId) return;
  const socket = io.sockets.sockets.get(player.socketId);
  socket?.emit('gameState', buildGameState(room, player.id));
}

function broadcastGameState(room) {
  for (const player of room.players.values()) {
    emitGameStateToPlayer(room, player);
  }
}

function syncRoom(room) {
  broadcastGameState(room);
  return buildGameState(room, null);
}

function cleanupRoomIfEmpty(roomId, room) {
  const hasOnlinePlayers = Array.from(room.players.values()).some((player) => player.online);
  if (hasOnlinePlayers) return false;

  if (!room.engine || room.engine.canStart()) {
    for (const player of room.players.values()) {
      tokenIndex.delete(player.token);
    }
    rooms.delete(roomId);
    console.log(`[room:empty] removed ${roomId}`);
    return true;
  }

  return false;
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('room:create', ({ playerName }, ack) => {
    const name = String(playerName || '').trim() || '匿名玩家';
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = createPlayer(name);

    attachPlayerToSocket(socket, roomId, player);
    room.players.set(player.id, player);
    rooms.set(roomId, room);
    tokenIndex.set(player.token, { roomId, playerId: player.id });

    const gameState = syncRoom(room);
    ack?.({ ok: true, session: buildSession(player, roomId), gameState: buildGameState(room, player.id) });
    console.log(`[room:create] ${roomId} by ${name}`);
  });

  socket.on('room:join', ({ roomId, playerName }, ack) => {
    const id = String(roomId || '').trim().toUpperCase();
    const name = String(playerName || '').trim() || '匿名玩家';
    const room = rooms.get(id);

    if (!room) {
      ack?.({ ok: false, error: '房间不存在' });
      return;
    }

    if (socket.data.roomId && socket.data.roomId !== id) {
      ack?.({ ok: false, error: '你已在一个房间中，请先断开重连' });
      return;
    }

    const player = createPlayer(name);
    attachPlayerToSocket(socket, id, player);
    room.players.set(player.id, player);
    tokenIndex.set(player.token, { roomId: id, playerId: player.id });

    syncRoom(room);
    ack?.({ ok: true, session: buildSession(player, id), gameState: buildGameState(room, player.id) });
    console.log(`[room:join] ${id} <- ${name}`);
  });

  socket.on('room:resume', ({ roomId, playerId, token }, ack) => {
    const id = String(roomId || '').trim().toUpperCase();
    const saved = tokenIndex.get(String(token || ''));
    const room = rooms.get(id);
    const player = room?.players.get(String(playerId || ''));

    if (!saved || saved.roomId !== id || saved.playerId !== player?.id || !room || !player) {
      ack?.({ ok: false, error: '无法恢复会话，请重新加入房间' });
      return;
    }

    attachPlayerToSocket(socket, id, player);
    syncRoom(room);
    ack?.({ ok: true, session: buildSession(player, id), gameState: buildGameState(room, player.id) });
    console.log(`[room:resume] ${id} <- ${player.name}`);
  });

  socket.on('game:start', (_payload, ack) => {
    const { roomId, room, player } = getRoomAndPlayer(socket);
    if (!roomId || !player) {
      ack?.({ ok: false, error: '未在房间中' });
      return;
    }
    if (!room) {
      ack?.({ ok: false, error: '房间不存在' });
      return;
    }

    if (room.engine && !room.engine.canStart()) {
      ack?.({ ok: false, error: '当前局未结束' });
      return;
    }

    const entries = [...room.players.entries()].filter(([, p]) => p.online);
    room.engine = new GameEngine(roomId, entries);
    const result = room.engine.startHand();
    if (!result.ok) {
      room.engine = null;
      ack?.(result);
      return;
    }

    broadcastGameState(room);
    ack?.({ ok: true, gameState: buildGameState(room, player.id) });
    console.log(`[game:start] ${roomId}`);
  });

  socket.on('game:action', ({ action, amount }, ack) => {
    const { room, player } = getRoomAndPlayer(socket);
    if (!player) {
      ack?.({ ok: false, error: '未在房间中' });
      return;
    }
    if (!room?.engine) {
      ack?.({ ok: false, error: '牌局未开始' });
      return;
    }

    const result = room.engine.applyAction(player.id, action, amount);
    if (!result.ok) {
      ack?.(result);
      return;
    }

    broadcastGameState(room);
    ack?.({ ok: true, gameState: buildGameState(room, player.id) });
  });

  socket.on('disconnect', () => {
    const { roomId, room, player } = getRoomAndPlayer(socket);
    if (!roomId || !room || !player) return;

    if (player.socketId !== socket.id) return;

    player.socketId = null;
    player.online = false;
    console.log(`[disconnect] ${player.name} offline in ${roomId}`);

    if (cleanupRoomIfEmpty(roomId, room)) return;

    broadcastGameState(room);
  });
});

const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`Texas Hold'em server running at http://${HOST}:${PORT}`);
  console.log(`CORS origins: ${CLIENT_ORIGINS.join(', ')}${ALLOW_LAN ? ' (+ LAN)' : ''}`);
});
