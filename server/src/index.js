import express from 'express';
import { createServer } from 'http';
import { RoomManager } from './roomManager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';

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

function isAllowedPublicHost(hostname) {
  return (
    hostname.endsWith('.lhr.life') ||
    hostname.endsWith('.loca.lt') ||
    hostname.endsWith('.up.railway.app') ||
    hostname.endsWith('.railway.app') ||
    hostname.endsWith('.onrender.com')
  );
}

function corsOrigin(origin, callback) {
  if (!origin || CLIENT_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    if ((protocol === 'http:' || protocol === 'https:') && (isAllowedPublicHost(hostname) || (ALLOW_LAN && isPrivateHost(hostname)))) {
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

const roomManager = new RoomManager({
  onRoomChanged: (room) => broadcastGameState(room),
});

function attachPlayerToSocket(socket, roomId, player) {
  if (socket.data.roomId && socket.data.playerId && socket.data.playerId !== player.id) {
    const { room: previousRoom, player: previousPlayer } = roomManager.getRoomAndPlayer(socket.data.roomId, socket.data.playerId);
    if (previousRoom && previousPlayer?.socketId === socket.id) {
      roomManager.markOffline(previousRoom.id, previousPlayer.id);
    }
  }

  if (player.socketId && player.socketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(player.socketId);
    oldSocket?.leave(roomId);
    oldSocket?.disconnect(true);
  }

  roomManager.clearOfflineFoldTimer(player);
  player.socketId = socket.id;
  player.online = true;
  player.offlineAt = null;
  socket.join(roomId);
  socket.data.roomId = roomId;
  socket.data.playerId = player.id;
  socket.data.playerName = player.name;
}

function getRoomAndPlayer(socket) {
  return roomManager.getRoomAndPlayer(socket.data.roomId, socket.data.playerId);
}

function buildGameState(room, viewerPlayerId) {
  return roomManager.buildGameState(room, viewerPlayerId);
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

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('room:create', ({ playerName }, ack) => {
    const name = String(playerName || '').trim() || '匿名玩家';
    const { room, player } = roomManager.createRoom(name);

    attachPlayerToSocket(socket, room.id, player);

    const gameState = syncRoom(room);
    ack?.({ ok: true, session: roomManager.buildSession(player, room.id), gameState: buildGameState(room, player.id) });
    console.log(`[room:create] ${room.id} by ${name}`);
  });

  socket.on('room:join', ({ roomId, playerName }, ack) => {
    const id = String(roomId || '').trim().toUpperCase();
    const name = String(playerName || '').trim() || '匿名玩家';

    if (socket.data.roomId && socket.data.roomId !== id) {
      ack?.({ ok: false, error: '你已在一个房间中，请先退出当前房间' });
      return;
    }

    const result = roomManager.joinRoom(id, name);

    if (!result.ok) {
      ack?.(result);
      return;
    }

    const { room, player } = result;
    attachPlayerToSocket(socket, id, player);

    syncRoom(room);
    ack?.({ ok: true, session: roomManager.buildSession(player, id), gameState: buildGameState(room, player.id) });
    console.log(`[room:join] ${id} <- ${name}`);
  });

  socket.on('room:resume', ({ roomId, playerId, token }, ack) => {
    const id = String(roomId || '').trim().toUpperCase();
    const result = roomManager.resume(id, playerId, token);

    if (!result.ok) {
      ack?.(result);
      return;
    }

    const { room, player } = result;
    attachPlayerToSocket(socket, id, player);
    syncRoom(room);
    ack?.({ ok: true, session: roomManager.buildSession(player, id), gameState: buildGameState(room, player.id) });
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

    const result = roomManager.startHand(roomId);
    if (!result.ok) {
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

    const result = roomManager.applyAction(room, player, action, amount);
    if (!result.ok) {
      ack?.(result);
      return;
    }

    broadcastGameState(room);
    ack?.({ ok: true, gameState: buildGameState(room, player.id) });
  });

  socket.on('room:leave', (_payload, ack) => {
    const { roomId, room, player } = getRoomAndPlayer(socket);
    if (!roomId || !room || !player) {
      ack?.({ ok: false, error: '未在房间中' });
      return;
    }

    const result = roomManager.leaveRoom(roomId, player.id);
    if (!result.ok) {
      ack?.(result);
      return;
    }

    socket.leave(roomId);
    socket.data.roomId = null;
    socket.data.playerId = null;
    socket.data.playerName = null;

    if (result.roomRemoved) {
      ack?.({ ok: true });
      console.log(`[room:leave] ${player.name} left and removed ${roomId}`);
      return;
    }

    broadcastGameState(room);
    ack?.({ ok: true });
    console.log(`[room:leave] ${player.name} left ${roomId}`);
  });

  socket.on('disconnect', () => {
    const { roomId, room, player } = getRoomAndPlayer(socket);
    if (!roomId || !room || !player) return;

    if (player.socketId !== socket.id) return;

    const offlineResult = roomManager.markOffline(roomId, player.id);
    if (offlineResult.removed) return;

    console.log(`[disconnect] ${player.name} offline in ${roomId}`);
    broadcastGameState(room);
  });
});

const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`Texas Hold'em server running at http://${HOST}:${PORT}`);
  console.log(`CORS origins: ${CLIENT_ORIGINS.join(', ')}${ALLOW_LAN ? ' (+ LAN)' : ''}`);
});
