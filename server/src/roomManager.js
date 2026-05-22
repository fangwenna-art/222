import { randomUUID } from 'crypto';
import { GameEngine } from './gameEngine.js';

const OFFLINE_AUTO_FOLD_MS = Number(process.env.OFFLINE_AUTO_FOLD_MS || 30000);

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createPlayer(name) {
  return {
    id: randomUUID(),
    token: randomUUID(),
    name,
    socketId: null,
    online: true,
    chips: null,
    offlineAt: null,
    offlineFoldTimer: null,
  };
}

function createRoom(roomId) {
  return {
    id: roomId,
    players: new Map(),
    engine: null,
    dealerSeatId: null,
  };
}

export class RoomManager {
  constructor({ onRoomChanged } = {}) {
    this.rooms = new Map();
    this.tokenIndex = new Map();
    this.onRoomChanged = onRoomChanged || (() => {});
  }

  createRoom(playerName) {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = createPlayer(playerName);
    room.players.set(player.id, player);
    this.rooms.set(roomId, room);
    this.tokenIndex.set(player.token, { roomId, playerId: player.id });
    return { room, player };
  }

  joinRoom(roomId, playerName) {
    const id = String(roomId || '').trim().toUpperCase();
    const room = this.rooms.get(id);
    if (!room) return { ok: false, error: '房间不存在' };

    const player = createPlayer(playerName);
    room.players.set(player.id, player);
    this.tokenIndex.set(player.token, { roomId: id, playerId: player.id });
    return { ok: true, room, player };
  }

  resume(roomId, playerId, token) {
    const id = String(roomId || '').trim().toUpperCase();
    const saved = this.tokenIndex.get(String(token || ''));
    const room = this.rooms.get(id);
    const player = room?.players.get(String(playerId || ''));

    if (!saved || saved.roomId !== id || saved.playerId !== player?.id || !room || !player) {
      return { ok: false, error: '无法恢复会话，请重新加入房间' };
    }

    this.clearOfflineFoldTimer(player);
    player.online = true;
    player.offlineAt = null;
    return { ok: true, room, player };
  }

  getRoomAndPlayer(roomId, playerId) {
    if (!roomId || !playerId) return { roomId: null, room: null, player: null };
    const room = this.rooms.get(roomId);
    const player = room?.players.get(playerId) ?? null;
    return { roomId, room, player };
  }

  buildSession(player, roomId) {
    return {
      roomId,
      playerId: player.id,
      token: player.token,
      playerName: player.name,
    };
  }

  startHand(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.engine && !room.engine.canStart()) return { ok: false, error: '当前局未结束' };

    const entries = [...room.players.entries()].filter(([, player]) => player.online && (player.chips ?? 1) > 0);
    const engine = new GameEngine(roomId, entries, {
      startingChipsByPlayerId: Object.fromEntries(entries.map(([id, player]) => [id, player.chips]).filter(([, chips]) => chips != null)),
      dealerPlayerId: room.dealerSeatId,
    });

    const result = engine.startHand();
    if (!result.ok) return result;

    room.engine = engine;
    room.dealerSeatId = engine.getDealerId();
    this.syncChipsFromEngine(room);
    return { ok: true, room };
  }

  applyAction(room, player, action, amount) {
    if (!room?.engine) return { ok: false, error: '牌局未开始' };
    const result = room.engine.applyAction(player.id, action, amount);
    this.syncChipsFromEngine(room);
    return result;
  }

  markOffline(roomId, playerId) {
    const { room, player } = this.getRoomAndPlayer(roomId, playerId);
    if (!room || !player) return { room: null, player: null, removed: false };

    player.socketId = null;
    player.online = false;
    player.offlineAt = Date.now();
    this.syncChipsFromEngine(room);

    if (room.engine && !room.engine.canStart()) {
      this.clearOfflineFoldTimer(player);
      player.offlineFoldTimer = setTimeout(() => {
        const latestRoom = this.rooms.get(roomId);
        const latestPlayer = latestRoom?.players.get(playerId);
        if (!latestRoom || !latestPlayer || latestPlayer.online) return;
        latestRoom.engine?.forceFold(playerId);
        this.syncChipsFromEngine(latestRoom);
        this.onRoomChanged(latestRoom);
      }, OFFLINE_AUTO_FOLD_MS);
    }

    return { room, player, removed: this.cleanupRoomIfEmpty(roomId, room) };
  }

  leaveRoom(roomId, playerId) {
    const { room, player } = this.getRoomAndPlayer(roomId, playerId);
    if (!room || !player) return { ok: false, error: '未在房间中' };

    if (room.engine && !room.engine.canStart()) {
      room.engine.forceFold(player.id);
      this.syncChipsFromEngine(room);
    }

    this.clearOfflineFoldTimer(player);
    this.tokenIndex.delete(player.token);
    room.players.delete(player.id);

    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      return { ok: true, roomRemoved: true, room, player };
    }

    return { ok: true, roomRemoved: false, room, player };
  }

  clearOfflineFoldTimer(player) {
    if (player?.offlineFoldTimer) {
      clearTimeout(player.offlineFoldTimer);
      player.offlineFoldTimer = null;
    }
  }

  syncChipsFromEngine(room) {
    if (!room?.engine) return;
    for (const [id, player] of room.players.entries()) {
      const seat = room.engine.seats[id];
      if (seat) player.chips = seat.chips;
    }
  }

  buildGameState(room, viewerPlayerId) {
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
        chips: p.chips,
      })),
      hand: room.engine ? room.engine.toPublicState(viewerPlayerId) : null,
    };
  }

  cleanupRoomIfEmpty(roomId, room) {
    const hasOnlinePlayers = Array.from(room.players.values()).some((player) => player.online);
    if (hasOnlinePlayers) return false;

    if (!room.engine || room.engine.canStart()) {
      for (const player of room.players.values()) {
        this.clearOfflineFoldTimer(player);
        this.tokenIndex.delete(player.token);
      }
      this.rooms.delete(roomId);
      return true;
    }

    return false;
  }
}
