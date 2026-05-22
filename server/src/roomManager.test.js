import { RoomManager } from './roomManager.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const manager = new RoomManager();
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

console.log('全部房间控制测试通过');
