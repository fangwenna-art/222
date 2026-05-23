import { randomUUID } from 'crypto';
import { DEFAULT_GAME_SETTINGS, GameEngine } from './gameEngine.js';

const OFFLINE_AUTO_FOLD_MS = Number(process.env.OFFLINE_AUTO_FOLD_MS || 30000);
const ACTION_TIMEOUT_MS = Number(process.env.ACTION_TIMEOUT_MS || 30000);
const SHOWDOWN_PAUSE_MS = Number(process.env.SHOWDOWN_PAUSE_MS || 1800);
const MAX_PLAYERS_PER_ROOM = Number(process.env.MAX_PLAYERS_PER_ROOM || 9);
const MAX_HAND_HISTORY = Number(process.env.MAX_HAND_HISTORY || 10);

export { OFFLINE_AUTO_FOLD_MS };

function offlineFoldDeadlineAt(player, room) {
  if (!player || player.online || !player.offlineAt || !player.offlineFoldTimer) return null;
  if (!room.engine || room.engine.canStart()) return null;
  const seat = room.engine.seats[player.id];
  if (!seat || seat.folded) return null;
  return player.offlineAt + OFFLINE_AUTO_FOLD_MS;
}

function getWaitingPlayers(room) {
  const seatIds = room.engine ? new Set(Object.keys(room.engine.seats)) : new Set();
  return Array.from(room.players.values())
    .filter((player) => !seatIds.has(player.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      online: player.online,
      chips: player.chips,
      isHost: player.id === room.hostPlayerId,
    }));
}

function buildViewerContext(room, viewerPlayerId) {
  const player = room.players.get(viewerPlayerId);
  if (!player) return null;

  const seatIds = room.engine ? new Set(Object.keys(room.engine.seats)) : new Set();
  const inHand = seatIds.has(viewerPlayerId);
  const handActive = Boolean(room.engine && !room.engine.canStart());

  return {
    inHand,
    isSpectating: handActive && !inHand,
    isOffline: !player.online,
    offlineFoldDeadlineAt: offlineFoldDeadlineAt(player, room),
    joinNextHand: handActive && !inHand && player.online,
  };
}

function handHistorySignature(engine) {
  if (!engine || engine.phase !== 'ended') return '';
  return `${engine.message}|${(engine.winners || []).map((w) => `${w.id}:${w.amount}:${w.reason}`).join(',')}`;
}

function buildHandHistorySummary(engine) {
  const winners = engine.winners || [];
  if (!winners.length) return '本局结束';

  const totalsById = new Map();
  winners.forEach((winner) => {
    const current = totalsById.get(winner.id) || {
      name: winner.name,
      amount: 0,
      handName: winner.handName,
    };
    current.amount += winner.amount;
    if (winner.handName) current.handName = winner.handName;
    totalsById.set(winner.id, current);
  });

  const entries = [...totalsById.values()];
  if (entries.length === 1) {
    const entry = entries[0];
    const handHint = entry.handName ? ` · ${entry.handName}` : '';
    return `${entry.name} 获胜 +${entry.amount}${handHint}`;
  }

  if (entries.length === 2) {
    return entries
      .map((entry) => {
        const handHint = entry.handName ? ` · ${entry.handName}` : '';
        return `${entry.name} +${entry.amount}${handHint}`;
      })
      .join(' · ');
  }

  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return `${entries.length} 位赢家 · 共 ${total}`;
}

function createDefaultRoomSettings() {
  return { ...DEFAULT_GAME_SETTINGS };
}

function parseRoomSettings(payload, current = createDefaultRoomSettings()) {
  const startingChips = payload?.startingChips != null
    ? Math.floor(Number(payload.startingChips))
    : current.startingChips;
  const smallBlind = payload?.smallBlind != null
    ? Math.floor(Number(payload.smallBlind))
    : current.smallBlind;
  const bigBlind = payload?.bigBlind != null
    ? Math.floor(Number(payload.bigBlind))
    : current.bigBlind;

  if (!Number.isFinite(startingChips) || startingChips < 100 || startingChips > 100000) {
    return { ok: false, error: '起始筹码须为 100–100000' };
  }
  if (!Number.isFinite(smallBlind) || smallBlind < 1 || smallBlind > 5000) {
    return { ok: false, error: '小盲须为 1–5000' };
  }
  if (!Number.isFinite(bigBlind) || bigBlind < 2 || bigBlind > 10000) {
    return { ok: false, error: '大盲须为 2–10000' };
  }
  if (bigBlind < smallBlind) {
    return { ok: false, error: '大盲不能小于小盲' };
  }

  return {
    ok: true,
    settings: { startingChips, smallBlind, bigBlind },
  };
}

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
    hostPlayerId: null,
    actionTimer: null,
    actionDeadlineAt: null,
    showdownTimer: null,
    handHistory: [],
    lastHistorySignature: '',
    settings: createDefaultRoomSettings(),
    actionPausedForPlayerId: null,
    actionPausedRemainingMs: null,
  };
}

export class RoomManager {
  constructor({ onRoomChanged, actionTimeoutMs = ACTION_TIMEOUT_MS, showdownPauseMs = SHOWDOWN_PAUSE_MS } = {}) {
    this.rooms = new Map();
    this.tokenIndex = new Map();
    this.onRoomChanged = onRoomChanged || (() => {});
    this.actionTimeoutMs = actionTimeoutMs;
    this.showdownPauseMs = showdownPauseMs;
  }

  _scheduleActionTimer(room, delayMs = this.actionTimeoutMs) {
    this.clearActionTimer(room);
    const engine = room?.engine;
    const activePlayerId = engine?.activeIndex >= 0 ? engine.order[engine.activeIndex] : null;
    if (!engine || engine.canStart() || !activePlayerId) return;

    const activePlayer = room.players.get(activePlayerId);
    if (activePlayer && !activePlayer.online) {
      room.actionPausedForPlayerId = activePlayerId;
      room.actionPausedRemainingMs = delayMs;
      engine.actionDeadlineAt = null;
      return;
    }

    const pauseMs = Math.max(0, delayMs);
    room.actionDeadlineAt = Date.now() + pauseMs;
    engine.actionDeadlineAt = room.actionDeadlineAt;
    engine.actionTimeoutMs = pauseMs;
    room.actionTimer = setTimeout(() => {
      const latestRoom = this.rooms.get(room.id);
      const latestEngine = latestRoom?.engine;
      const latestActivePlayerId = latestEngine?.activeIndex >= 0 ? latestEngine.order[latestEngine.activeIndex] : null;
      if (!latestRoom || !latestEngine || latestEngine.canStart() || latestActivePlayerId !== activePlayerId) return;

      const latestActivePlayer = latestRoom.players.get(activePlayerId);
      if (latestActivePlayer && !latestActivePlayer.online) {
        latestRoom.actionPausedForPlayerId = activePlayerId;
        latestRoom.actionPausedRemainingMs = 0;
        latestEngine.actionDeadlineAt = null;
        return;
      }

      const seat = latestEngine.seats[activePlayerId];
      const toCall = seat ? Math.max(0, latestEngine.currentBet - seat.bet) : 0;
      if (toCall === 0) {
        latestEngine.applyAction(activePlayerId, 'check');
      } else {
        latestEngine.forceFold(activePlayerId, '行动超时');
      }
      this._afterEngineMutation(latestRoom);
      this.onRoomChanged(latestRoom);
    }, pauseMs);
  }

  clearShowdownTimer(room) {
    if (room?.showdownTimer) {
      clearTimeout(room.showdownTimer);
      room.showdownTimer = null;
    }
    if (room?.engine) room.engine.showdownDeadlineAt = null;
  }

  _scheduleShowdownTimer(room, delayMs = this.showdownPauseMs) {
    this.clearShowdownTimer(room);
    const engine = room?.engine;
    if (!engine?.isShowdownPending()) return;

    const pauseMs = Math.max(0, delayMs);
    engine.showdownDeadlineAt = Date.now() + pauseMs;
    room.showdownTimer = setTimeout(() => {
      const latestRoom = this.rooms.get(room.id);
      const latestEngine = latestRoom?.engine;
      if (!latestRoom || !latestEngine?.isShowdownPending()) return;

      latestEngine.finalizeShowdown();
      this.syncChipsFromEngine(latestRoom);
      this._maybeRecordHandHistory(latestRoom);
      this.onRoomChanged(latestRoom);
    }, pauseMs);
  }

  _recoverShowdown(room) {
    const engine = room?.engine;
    if (!engine?.isShowdownPending()) return false;

    const now = Date.now();
    const deadline = engine.showdownDeadlineAt;
    if (deadline && now >= deadline) {
      this.clearShowdownTimer(room);
      engine.finalizeShowdown();
      this.syncChipsFromEngine(room);
      this._maybeRecordHandHistory(room);
      return true;
    }

    if (!room.showdownTimer) {
      const remainMs = deadline && deadline > now ? deadline - now : this.showdownPauseMs;
      this._scheduleShowdownTimer(room, remainMs);
    }

    return false;
  }

  _prepareNextHand(room) {
    this._recoverShowdown(room);
    if (room.engine?.isShowdownPending()) {
      this.clearShowdownTimer(room);
      room.engine.finalizeShowdown();
      this.syncChipsFromEngine(room);
      this._maybeRecordHandHistory(room);
    }
  }

  _maybeRecordHandHistory(room) {
    const engine = room?.engine;
    if (!engine || engine.phase !== 'ended') return;

    const signature = handHistorySignature(engine);
    if (!signature || signature === room.lastHistorySignature) return;

    room.lastHistorySignature = signature;
    room.handHistory.unshift({
      summary: buildHandHistorySummary(engine),
      wasShowdown: (engine.showdownHands?.length ?? 0) > 0,
      endedAt: Date.now(),
    });
    if (room.handHistory.length > MAX_HAND_HISTORY) {
      room.handHistory.length = MAX_HAND_HISTORY;
    }
  }

  clearActionTimer(room) {
    if (room?.actionTimer) {
      clearTimeout(room.actionTimer);
      room.actionTimer = null;
    }
    if (room) room.actionDeadlineAt = null;
    if (room?.engine) room.engine.actionDeadlineAt = null;
  }

  _afterEngineMutation(room) {
    this.syncChipsFromEngine(room);
    if (room.engine?.isShowdownPending()) {
      this.clearActionTimer(room);
      this._scheduleShowdownTimer(room);
      return;
    }
    this._maybeRecordHandHistory(room);
    this._scheduleActionTimer(room);
  }

  createRoom(playerName) {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = createPlayer(playerName);
    player.chips = room.settings.startingChips;
    room.players.set(player.id, player);
    room.hostPlayerId = player.id;
    this.rooms.set(roomId, room);
    this.tokenIndex.set(player.token, { roomId, playerId: player.id });
    return { room, player };
  }

  joinRoom(roomId, playerName) {
    const id = String(roomId || '').trim().toUpperCase();
    const room = this.rooms.get(id);
    if (!room) return { ok: false, error: '房间不存在' };
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) return { ok: false, error: '房间已满' };

    const player = createPlayer(playerName);
    player.chips = room.settings.startingChips;
    room.players.set(player.id, player);
    this.tokenIndex.set(player.token, { roomId: id, playerId: player.id });
    return { ok: true, room, player };
  }

  resume(roomId, playerId, token) {
    const id = String(roomId || '').trim().toUpperCase();
    const saved = this.tokenIndex.get(String(token || ''));
    const room = this.rooms.get(id);
    const player = room?.players.get(String(playerId || ''));

    if (!room) {
      return { ok: false, code: 'ROOM_NOT_FOUND', error: '房间已解散，请重新加入' };
    }
    if (!saved || saved.roomId !== id) {
      return { ok: false, code: 'SESSION_INVALID', error: '会话已失效，请重新加入房间' };
    }
    if (!player || saved.playerId !== player.id) {
      return { ok: false, code: 'PLAYER_NOT_FOUND', error: '玩家不在房间中，请重新加入' };
    }

    this.clearOfflineFoldTimer(player);
    player.online = true;
    player.offlineAt = null;
    return { ok: true, room, player };
  }

  onPlayerOnline(room, player) {
    if (!room || !player) return;

    if (room.actionPausedForPlayerId === player.id) {
      const remainMs = Math.max(500, room.actionPausedRemainingMs ?? this.actionTimeoutMs);
      room.actionPausedForPlayerId = null;
      room.actionPausedRemainingMs = null;
      this._scheduleActionTimer(room, remainMs);
      return;
    }

    const engine = room.engine;
    const activePlayerId = engine?.activeIndex >= 0 ? engine.order[engine.activeIndex] : null;
    if (engine && !engine.canStart() && activePlayerId === player.id && !room.actionTimer) {
      this._scheduleActionTimer(room);
    }
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

  _ensureHost(room) {
    if (!room || room.players.has(room.hostPlayerId)) return;
    const nextHost = Array.from(room.players.values()).find((player) => player.online) || Array.from(room.players.values())[0] || null;
    room.hostPlayerId = nextHost?.id || null;
  }

  startHand(roomId, requesterPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    this._ensureHost(room);
    if (room.hostPlayerId && requesterPlayerId && requesterPlayerId !== room.hostPlayerId) {
      return { ok: false, error: '只有房主可以开始新一局' };
    }

    this._prepareNextHand(room);
    if (room.engine && !room.engine.canStart()) {
      return { ok: false, error: '当前局未结束，请稍候再试' };
    }

    const entries = [...room.players.entries()].filter(([, player]) => player.online && (player.chips ?? 1) > 0);
    if (entries.length < 2) {
      return { ok: false, error: '至少需要 2 名在线且有筹码的玩家' };
    }
    const engine = new GameEngine(roomId, entries, {
      startingChipsByPlayerId: Object.fromEntries(entries.map(([id, player]) => [id, player.chips]).filter(([, chips]) => chips != null)),
      dealerPlayerId: room.dealerSeatId,
      smallBlind: room.settings.smallBlind,
      bigBlind: room.settings.bigBlind,
      defaultStartingChips: room.settings.startingChips,
    });

    const result = engine.startHand();
    if (!result.ok) return result;

    room.engine = engine;
    room.dealerSeatId = engine.getDealerId();
    this.clearShowdownTimer(room);
    this._afterEngineMutation(room);
    return { ok: true, room };
  }

  updateRoomSettings(roomId, requesterPlayerId, payload) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: '房间不存在' };
    this._ensureHost(room);
    if (room.hostPlayerId && requesterPlayerId && requesterPlayerId !== room.hostPlayerId) {
      return { ok: false, error: '只有房主可以修改房间设置' };
    }
    if (room.engine && !room.engine.canConfigureRoom()) {
      return { ok: false, error: '牌局进行中，无法修改设置' };
    }

    const parsed = parseRoomSettings(payload, room.settings);
    if (!parsed.ok) return parsed;

    room.settings = parsed.settings;
    if (!room.engine) {
      for (const player of room.players.values()) {
        player.chips = room.settings.startingChips;
      }
    }

    return { ok: true, room, settings: room.settings };
  }

  applyAction(room, player, action, amount) {
    if (!room?.engine) return { ok: false, error: '牌局未开始' };
    const result = room.engine.applyAction(player.id, action, amount);
    this._afterEngineMutation(room);
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
      const activePlayerId = room.engine.activeIndex >= 0 ? room.engine.order[room.engine.activeIndex] : null;
      if (activePlayerId === playerId && room.actionTimer) {
        room.actionPausedForPlayerId = playerId;
        room.actionPausedRemainingMs = room.actionDeadlineAt
          ? Math.max(0, room.actionDeadlineAt - Date.now())
          : this.actionTimeoutMs;
        this.clearActionTimer(room);
        room.engine.actionDeadlineAt = null;
      }

      this.clearOfflineFoldTimer(player);
      player.offlineFoldTimer = setTimeout(() => {
        const latestRoom = this.rooms.get(roomId);
        const latestPlayer = latestRoom?.players.get(playerId);
        if (!latestRoom || !latestPlayer || latestPlayer.online) return;
        latestRoom.engine?.forceFold(playerId, '离线超时');
        this._afterEngineMutation(latestRoom);
        this.onRoomChanged(latestRoom);
      }, OFFLINE_AUTO_FOLD_MS);
    }

    return { room, player, removed: this.cleanupRoomIfEmpty(roomId, room) };
  }

  leaveRoom(roomId, playerId) {
    const { room, player } = this.getRoomAndPlayer(roomId, playerId);
    if (!room || !player) return { ok: false, error: '未在房间中' };

    if (room.engine && !room.engine.canStart()) {
      room.engine.forceFold(player.id, '离开房间');
      this._afterEngineMutation(room);
    }

    this.clearOfflineFoldTimer(player);
    this.tokenIndex.delete(player.token);
    room.players.delete(player.id);
    this._ensureHost(room);

    if (room.players.size === 0) {
      this.clearActionTimer(room);
      this.clearShowdownTimer(room);
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
    this._recoverShowdown(room);
    if (room.engine) {
      room.engine.onlineStatus = Object.fromEntries(
        Array.from(room.players.values()).map((p) => [p.id, p.online]),
      );
    }

    return {
      roomId: room.id,
      hostPlayerId: room.hostPlayerId,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        online: p.online,
        chips: p.chips,
        isHost: p.id === room.hostPlayerId,
        offlineFoldDeadlineAt: offlineFoldDeadlineAt(p, room),
      })),
      waitingPlayers: getWaitingPlayers(room),
      viewer: viewerPlayerId ? buildViewerContext(room, viewerPlayerId) : null,
      hand: room.engine ? room.engine.toPublicState(viewerPlayerId) : null,
      handHistory: room.handHistory.map(({ summary, wasShowdown, endedAt }) => ({
        summary,
        wasShowdown,
        endedAt,
      })),
      roomSettings: { ...room.settings },
      canEditSettings: !room.engine || room.engine.canConfigureRoom(),
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
      this.clearActionTimer(room);
      this.clearShowdownTimer(room);
      this.rooms.delete(roomId);
      return true;
    }

    return false;
  }
}
