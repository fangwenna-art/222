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
}

console.log('全部房间控制测试通过');
