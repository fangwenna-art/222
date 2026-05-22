import { GameEngine } from './gameEngine.js';

function card(rank, suit = 's') {
  return { rank, suit };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeEngine() {
  return new GameEngine('TEST', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
    ['C', { name: 'C' }],
  ]);
}

{
  const engine = makeEngine();
  engine.phase = 'river';
  engine.community = [card(2, 'c'), card(7, 'd'), card(9, 'h'), card(11, 's'), card(13, 'c')];
  engine.pot = 300;
  engine.seats.A.totalBet = 100;
  engine.seats.B.totalBet = 100;
  engine.seats.C.totalBet = 100;
  engine.seats.A.holeCards = [card(14, 's'), card(3, 'd')];
  engine.seats.B.holeCards = [card(14, 'h'), card(3, 'c')];
  engine.seats.C.holeCards = [card(12, 's'), card(4, 'd')];
  engine._showdown();
  assert(engine.seats.A.chips === 1150, `A should split main pot, got ${engine.seats.A.chips}`);
  assert(engine.seats.B.chips === 1150, `B should split main pot, got ${engine.seats.B.chips}`);
  assert(engine.seats.C.chips === 1000, `C should win nothing, got ${engine.seats.C.chips}`);
}

{
  const engine = makeEngine();
  engine.phase = 'river';
  engine.community = [card(2, 'c'), card(7, 'd'), card(9, 'h'), card(11, 's'), card(13, 'c')];
  engine.pot = 600;
  engine.seats.A.totalBet = 100;
  engine.seats.B.totalBet = 200;
  engine.seats.C.totalBet = 300;
  engine.seats.A.allIn = true;
  engine.seats.B.allIn = true;
  engine.seats.A.holeCards = [card(14, 's'), card(3, 'd')];
  engine.seats.B.holeCards = [card(12, 'h'), card(3, 'c')];
  engine.seats.C.holeCards = [card(10, 's'), card(4, 'd')];
  engine._showdown();
  assert(engine.seats.A.chips === 1300, `A should win main pot 300, got ${engine.seats.A.chips}`);
  assert(engine.seats.B.chips === 1200, `B should win side pot 200, got ${engine.seats.B.chips}`);
  assert(engine.seats.C.chips === 1100, `C should receive uncontested side pot 100, got ${engine.seats.C.chips}`);
}

console.log('全部结算测试通过');
