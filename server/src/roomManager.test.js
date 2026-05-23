import { RoomManager } from './roomManager.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const manager = new RoomManager({ actionTimeoutMs: 1000000 });
const { room, player: a } = manager.createRoom('A');
const joinB = manager.joinRoom(room.id, 'B');
const joinC = manager.joinRoom(room.id, 'C');
assert(joinB.ok && joinC.ok, 'B/C should join room');

const b = joinB.player;
const c = joinC.player;
a.online = true;
b.online = true;
c.online = true;

let result = manager.startHand(room.id);
assert(result.ok, 'first hand should start');
assert(room.engine.getDealerId() === a.id, 'first dealer should be first player');
room.engine.phase = 'ended';
manager.syncChipsFromEngine(room);

result = manager.startHand(room.id);
assert(result.ok, 'second hand should start');
assert(room.engine.getDealerId() === b.id, 'second dealer should rotate to next player');
room.engine.phase = 'ended';
room.engine.seats[a.id].chips = 1234;
manager.syncChipsFromEngine(room);
assert(a.chips === 1234, 'chips should sync back to room player');

result = manager.startHand(room.id);
assert(result.ok, 'third hand should start');
assert(room.engine.getDealerId() === c.id, 'third dealer should rotate to next player');
assert(room.engine.seats[a.id].chips === 1224, 'next hand should preserve player chips before posting blinds');
manager.clearActionTimer(room);

{
  const hostManager = new RoomManager({ actionTimeoutMs: 1000000 });
  const { room: hostRoom, player: host } = hostManager.createRoom('Host');
  const guestJoin = hostManager.joinRoom(hostRoom.id, 'Guest');
  assert(guestJoin.ok, 'guest should join host room');
  assert(hostRoom.hostPlayerId === host.id, 'creator should be host');
  let denied = hostManager.startHand(hostRoom.id, guestJoin.player.id);
  assert(!denied.ok && denied.error.includes('房主'), 'non-host should not start hand');
  let allowed = hostManager.startHand(hostRoom.id, host.id);
  assert(allowed.ok, 'host should start hand');
  hostRoom.engine.phase = 'ended';
  hostManager.clearActionTimer(hostRoom);
  const leave = hostManager.leaveRoom(hostRoom.id, host.id);
  assert(leave.ok, 'host should leave room');
  assert(hostRoom.hostPlayerId === guestJoin.player.id, 'host should transfer to next player');
  hostManager.clearActionTimer(hostRoom);
}

{
  const limitManager = new RoomManager({ actionTimeoutMs: 1000000 });
  const { room: limitRoom } = limitManager.createRoom('P1');
  for (let i = 2; i <= 9; i++) {
    const joined = limitManager.joinRoom(limitRoom.id, `P${i}`);
    assert(joined.ok, `P${i} should join before room is full`);
  }
  const overflow = limitManager.joinRoom(limitRoom.id, 'P10');
  assert(!overflow.ok && overflow.error.includes('房间已满'), '10th player should be rejected');
}

{
  let changedRoom = null;
  const timeoutManager = new RoomManager({
    actionTimeoutMs: 20,
    onRoomChanged: (updatedRoom) => {
      changedRoom = updatedRoom;
    },
  });
  const { room: timeoutRoom } = timeoutManager.createRoom('A');
  const joined = timeoutManager.joinRoom(timeoutRoom.id, 'B');
  assert(joined.ok, 'timeout room should accept B');
  const started = timeoutManager.startHand(timeoutRoom.id);
  assert(started.ok, 'timeout hand should start');
  const firstActorId = timeoutRoom.engine.order[timeoutRoom.engine.activeIndex];
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert(changedRoom === timeoutRoom, 'timeout should broadcast changed room');
  assert(timeoutRoom.engine.seats[firstActorId].folded || timeoutRoom.engine.seats[firstActorId].acted, 'timeout should auto act for active player');
  assert(timeoutRoom.engine.actionLogs.some((log) => log.note === '行动超时' || log.action === 'check'), 'timeout should be logged');
  timeoutManager.clearActionTimer(timeoutRoom);
  timeoutManager.clearShowdownTimer(timeoutRoom);
}

{
  let phaseAfterAction = null;
  let phaseAfterFinalize = null;
  const showdownManager = new RoomManager({
    actionTimeoutMs: 1000000,
    showdownPauseMs: 40,
    onRoomChanged: (updatedRoom) => {
      phaseAfterFinalize = updatedRoom.engine?.phase || null;
    },
  });
  const { room: showdownRoom } = showdownManager.createRoom('A');
  const joined = showdownManager.joinRoom(showdownRoom.id, 'B');
  assert(joined.ok, 'showdown room should accept B');
  const started = showdownManager.startHand(showdownRoom.id);
  assert(started.ok, 'showdown pause hand should start');
  showdownRoom.engine.applyAction(showdownRoom.engine.order[showdownRoom.engine.activeIndex], 'allin');
  showdownRoom.engine.applyAction(showdownRoom.engine.order[showdownRoom.engine.activeIndex], 'call');
  showdownManager._afterEngineMutation(showdownRoom);
  phaseAfterAction = showdownRoom.engine.phase;
  assert(phaseAfterAction === 'showdown', `room flow should pause at showdown, got ${phaseAfterAction}`);
  assert(showdownRoom.engine.showdownDeadlineAt, 'showdown deadline should be scheduled');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(phaseAfterFinalize === 'ended', `showdown timer should finalize to ended, got ${phaseAfterFinalize}`);
  showdownManager.clearShowdownTimer(showdownRoom);
}

{
  const recoveryManager = new RoomManager({ actionTimeoutMs: 1000000, showdownPauseMs: 1000000 });
  const { room: recoveryRoom } = recoveryManager.createRoom('A');
  const joined = recoveryManager.joinRoom(recoveryRoom.id, 'B');
  assert(joined.ok, 'recovery room should accept B');
  recoveryManager.startHand(recoveryRoom.id);
  let guard = 0;
  while (
    recoveryRoom.engine.phase !== 'showdown'
    && recoveryRoom.engine.phase !== 'ended'
    && guard++ < 30
  ) {
    const actorId = recoveryRoom.engine.order[recoveryRoom.engine.activeIndex];
    const seat = recoveryRoom.engine.seats[actorId];
    const toCall = Math.max(0, recoveryRoom.engine.currentBet - seat.bet);
    recoveryManager.applyAction(recoveryRoom, { id: actorId }, toCall === 0 ? 'check' : 'call');
  }
  assert(recoveryRoom.engine.phase === 'showdown', 'recovery setup should reach showdown');
  recoveryRoom.engine.showdownDeadlineAt = Date.now() - 1;
  assert(recoveryManager.buildGameState(recoveryRoom, 'A').hand.phase === 'ended', 'buildGameState should finalize overdue showdown');
  recoveryManager.clearShowdownTimer(recoveryRoom);
}

{
  const startManager = new RoomManager({ actionTimeoutMs: 1000000, showdownPauseMs: 1000000 });
  const { room: startRoom, player: host } = startManager.createRoom('A');
  const joined = startManager.joinRoom(startRoom.id, 'B');
  assert(joined.ok, 'start recovery room should accept B');
  startManager.startHand(startRoom.id);
  let guard = 0;
  while (
    startRoom.engine.phase !== 'showdown'
    && startRoom.engine.phase !== 'ended'
    && guard++ < 30
  ) {
    const actorId = startRoom.engine.order[startRoom.engine.activeIndex];
    const seat = startRoom.engine.seats[actorId];
    const toCall = Math.max(0, startRoom.engine.currentBet - seat.bet);
    startManager.applyAction(startRoom, { id: actorId }, toCall === 0 ? 'check' : 'call');
  }
  assert(startRoom.engine.phase === 'showdown', `hand should pause at showdown before forced restart, got ${startRoom.engine.phase}`);
  const restarted = startManager.startHand(startRoom.id, host.id);
  assert(restarted.ok, 'startHand should finalize pending showdown and start next hand');
  assert(startRoom.engine.phase === 'preflop', `new hand should begin at preflop, got ${startRoom.engine.phase}`);
  startManager.clearShowdownTimer(startRoom);
}

{
  const historyManager = new RoomManager({ actionTimeoutMs: 1000000, showdownPauseMs: 1000000 });
  const { room: historyRoom } = historyManager.createRoom('A');
  const joined = historyManager.joinRoom(historyRoom.id, 'B');
  assert(joined.ok, 'history room should accept B');
  historyManager.startHand(historyRoom.id);
  const raiserId = historyRoom.engine.order[historyRoom.engine.activeIndex];
  const folderId = historyRoom.engine.order[(historyRoom.engine.activeIndex + 1) % historyRoom.engine.order.length];
  historyRoom.engine.applyAction(raiserId, 'raise', 40);
  historyRoom.engine.applyAction(folderId, 'fold');
  historyManager._afterEngineMutation(historyRoom);
  const state = historyManager.buildGameState(historyRoom, raiserId);
  assert(state.handHistory?.length === 1, 'fold win should append one hand history entry');
  assert(state.handHistory[0].summary.includes('+'), `history summary should include payout, got ${state.handHistory[0].summary}`);
  assert(state.handHistory[0].wasShowdown === false, 'fold win should not mark showdown history');
  historyManager.clearShowdownTimer(historyRoom);
}

{
  const settingsManager = new RoomManager({ actionTimeoutMs: 1000000 });
  const { room: settingsRoom, player: host } = settingsManager.createRoom('A');
  const guestJoin = settingsManager.joinRoom(settingsRoom.id, 'B');
  assert(guestJoin.ok, 'settings room should accept guest');
  assert(settingsRoom.settings.startingChips === 1000, 'default starting chips should be 1000');
  assert(host.chips === 1000 && guestJoin.player.chips === 1000, 'lobby players should show starting chips');

  const denied = settingsManager.updateRoomSettings(settingsRoom.id, guestJoin.player.id, { smallBlind: 5, bigBlind: 10 });
  assert(!denied.ok && denied.error.includes('房主'), 'non-host should not update settings');

  const updated = settingsManager.updateRoomSettings(settingsRoom.id, host.id, {
    startingChips: 2000,
    smallBlind: 25,
    bigBlind: 50,
  });
  assert(updated.ok, 'host should update room settings');
  assert(settingsRoom.settings.smallBlind === 25 && settingsRoom.settings.bigBlind === 50, 'blinds should persist on room');
  assert(host.chips === 2000 && guestJoin.player.chips === 2000, 'lobby chips should reset to new starting stack');

  settingsManager.startHand(settingsRoom.id, host.id);
  assert(settingsRoom.engine.smallBlind === 25 && settingsRoom.engine.bigBlind === 50, 'engine should use room blinds');

  const blocked = settingsManager.updateRoomSettings(settingsRoom.id, host.id, { smallBlind: 1 });
  assert(!blocked.ok && blocked.error.includes('进行中'), 'settings should be blocked during active hand');
  settingsRoom.engine.phase = 'showdown';
  const duringShowdown = settingsManager.updateRoomSettings(settingsRoom.id, host.id, { smallBlind: 30, bigBlind: 60 });
  assert(duringShowdown.ok, 'host should update settings during showdown');
  assert(settingsRoom.settings.smallBlind === 30, 'showdown settings update should persist');
  settingsRoom.engine.phase = 'ended';
  settingsManager.syncChipsFromEngine(settingsRoom);
  settingsManager.clearActionTimer(settingsRoom);
  settingsManager.clearShowdownTimer(settingsRoom);
}

{
  const reconnectManager = new RoomManager({ actionTimeoutMs: 8000 });
  const { room, player: host } = reconnectManager.createRoom('A');
  const joined = reconnectManager.joinRoom(room.id, 'B');
  assert(joined.ok, 'reconnect room should accept B');
  reconnectManager.startHand(room.id, host.id);
  const activeId = room.engine.order[room.engine.activeIndex];

  reconnectManager.markOffline(room.id, activeId);
  assert(room.actionPausedForPlayerId === activeId, 'active offline player should pause action timer');
  assert(!room.actionTimer, 'action timer should be cleared while active player offline');

  const activePlayer = room.players.get(activeId);
  activePlayer.online = true;
  activePlayer.offlineAt = null;
  reconnectManager.onPlayerOnline(room, activePlayer);
  assert(room.actionPausedForPlayerId == null, 'online should clear action pause marker');
  assert(room.actionTimer, 'action timer should resume after reconnect');

  reconnectManager.clearActionTimer(room);
  reconnectManager.clearShowdownTimer(room);
}

{
  const resumeManager = new RoomManager({ actionTimeoutMs: 1000000 });
  const { room, player: host } = resumeManager.createRoom('A');
  const joined = resumeManager.joinRoom(room.id, 'B');
  assert(joined.ok, 'resume room should accept B');
  joined.player.online = true;
  resumeManager.startHand(room.id, host.id);
  resumeManager.markOffline(room.id, host.id);
  assert(host.online === false, 'markOffline should set player offline');
  assert(host.offlineFoldTimer, 'mid-hand offline should schedule auto fold');

  const resumed = resumeManager.resume(room.id, host.id, host.token);
  assert(resumed.ok, 'valid resume should succeed');
  assert(host.online === true, 'resume should mark player online');
  assert(!host.offlineFoldTimer, 'resume should clear offline fold timer');

  const missingRoom = resumeManager.resume('NOPE', host.id, host.token);
  assert(!missingRoom.ok && missingRoom.code === 'ROOM_NOT_FOUND', 'missing room should return ROOM_NOT_FOUND');

  resumeManager.clearActionTimer(room);
  resumeManager.clearShowdownTimer(room);
}

{
  const cleanupManager = new RoomManager({ actionTimeoutMs: 1000000 });
  const { room, player: host } = cleanupManager.createRoom('A');
  const joined = cleanupManager.joinRoom(room.id, 'B');
  assert(joined.ok, 'cleanup room should accept B');
  host.online = false;
  joined.player.online = false;
  const removed = cleanupManager.markOffline(room.id, joined.player.id).removed;
  assert(removed === true, 'all offline between hands should remove room');
}

console.log('全部房间控制测试通过');
