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
  const engine = new GameEngine('BIGBLIND_OPTION', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
    ['C', { name: 'C' }],
  ]);
  engine.startHand();
  let result = engine.applyAction('A', 'call');
  assert(result.ok, 'UTG/button should be able to call preflop');
  result = engine.applyAction('B', 'call');
  assert(result.ok, 'small blind should be able to complete preflop');
  const state = engine.toPublicState('C');
  assert(state.availableActions.canCheck, 'big blind should be able to check when no raise preflop');
  assert(state.availableActions.canRaise, 'big blind should also be able to raise when action returns unopened');
}

{
  const engine = new GameEngine('HEADSUP_POSTFLOP', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
  ]);
  engine.startHand();
  assert(engine.order[engine.activeIndex] === 'A', 'heads-up button/small blind acts first preflop');
  let result = engine.applyAction('A', 'call');
  assert(result.ok, 'button should complete preflop');
  result = engine.applyAction('B', 'check');
  assert(result.ok, 'big blind should check option preflop');
  assert(engine.phase === 'flop', `hand should advance to flop, got ${engine.phase}`);
  assert(engine.order[engine.activeIndex] === 'B', 'heads-up big blind should act first postflop');
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
  assert(engine.winners.every((w) => w.reason === '主池摊牌'), 'equal-bet showdown should label main pot only');
  const mainPotLog = engine.actionLogs.find((log) => log.action === 'settle' && log.note.startsWith('主池'));
  assert(mainPotLog, 'showdown should log main pot settlement');
  assert(mainPotLog.note.includes('A +150'), `main pot log should include winner payout, got ${mainPotLog.note}`);
  assert(mainPotLog.note.includes('平分'), 'split main pot log should note tie');
  const publicState = engine.toPublicState('C');
  const revealedA = publicState.seats.find((seat) => seat.id === 'A')?.holeCards;
  const revealedB = publicState.seats.find((seat) => seat.id === 'B')?.holeCards;
  assert(revealedA?.includes('A♠') && revealedA?.includes('3♦'), 'ended hand should reveal A hole cards to opponents');
  assert(revealedB?.includes('A♥') && revealedB?.includes('3♣'), 'ended hand should reveal B hole cards to opponents');
  assert(publicState.showdownHands?.length === 3, 'showdown should expose all non-folded hand names');
  const loserC = publicState.showdownHands.find((entry) => entry.id === 'C');
  assert(loserC?.handName === '高牌', `losing showdown player should have hand name, got ${loserC?.handName}`);
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
  const settleLogs = engine.actionLogs.filter((log) => log.action === 'settle');
  assert(settleLogs.length === 3, `side-pot showdown should log 3 pot settlements, got ${settleLogs.length}`);
  assert(settleLogs.some((log) => log.note.startsWith('主池 300')), 'should log main pot amount');
  assert(settleLogs.some((log) => log.note.startsWith('边池1 200')), 'should log first side pot');
  assert(settleLogs.some((log) => log.note.startsWith('边池2 100')), 'should log second side pot');
  assert(engine.winners.some((w) => w.reason === '主池摊牌'), 'should include main pot winner detail');
  assert(engine.winners.some((w) => w.reason === '边池摊牌'), 'should include side pot winner details');
  const publicState = engine.toPublicState('A');
  assert(publicState.actionLogs.some((log) => log.action === 'settle'), 'public state should expose settle logs');
  assert(publicState.showdownHands?.length === 3, 'side-pot showdown should expose all showdown hand names');
  assert(
    publicState.showdownHands.some((entry) => entry.id === 'C' && entry.handName),
    'side-pot loser should include hand name in showdownHands',
  );
}

{
  const engine = new GameEngine('ALLIN', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
  ], {
    startingChipsByPlayerId: { A: 40, B: 40 },
  });
  const result = engine.startHand();
  assert(result.ok, 'all-in hand should start');
  engine.applyAction('A', 'allin');
  engine.applyAction('B', 'call');
  assert(engine.phase === 'ended', `all-in call should run out to ended, got ${engine.phase}`);
  assert(engine.community.length === 5, `runout should deal 5 community cards, got ${engine.community.length}`);
  assert(engine.actionLogs.some((log) => log.action === 'dealFlop'), 'action logs should include dealFlop');
  assert(engine.actionLogs.some((log) => log.action === 'showdown'), 'action logs should include showdown');
}

{
  const engine = new GameEngine('RAISE', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
    ['C', { name: 'C' }],
  ]);
  engine.startHand();
  assert(engine.lastRaiseAmount === 20, 'initial last raise should be big blind');
  engine.applyAction('A', 'raise', 40);
  assert(engine.currentBet === 60, `raise by 40 should set currentBet to 60, got ${engine.currentBet}`);
  assert(engine.lastRaiseAmount === 40, `lastRaiseAmount should become 40, got ${engine.lastRaiseAmount}`);
  const result = engine.applyAction('B', 'raise', 20);
  assert(!result.ok && result.error.includes('最小加注额'), 'min re-raise below lastRaiseAmount should be rejected');
}

{
  const engine = new GameEngine('VALIDATION', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
    ['C', { name: 'C' }],
  ]);
  engine.startHand();
  let result = engine.applyAction('A', 'raise', 10);
  assert(!result.ok && result.error.includes('最小加注额'), 'raise below lastRaiseAmount should be rejected');
  result = engine.applyAction('A', 'raise', 40);
  assert(result.ok, 'valid raise should pass');
  result = engine.applyAction('B', 'raise', 20);
  assert(!result.ok && result.error.includes('最小加注额'), 're-raise below updated lastRaiseAmount should be rejected');
}

{
  const engine = new GameEngine('BETVALIDATION', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
  ]);
  engine.phase = 'flop';
  engine.community = [card(2, 'c'), card(7, 'd'), card(9, 'h')];
  engine.activeIndex = 0;
  engine.currentBet = 0;
  engine.lastRaiseAmount = 20;
  engine.seats.A.holeCards = [card(14, 's'), card(3, 'd')];
  engine.seats.B.holeCards = [card(12, 'h'), card(3, 'c')];
  let result = engine.applyAction('A', 'bet', 10);
  assert(!result.ok && result.error.includes('最小下注'), 'bet below big blind should be rejected');
  result = engine.applyAction('A', 'bet', 40);
  assert(result.ok, 'valid bet should pass');
}

{
  const engine = new GameEngine('ACTIONS', [
    ['A', { name: 'A' }],
    ['B', { name: 'B' }],
    ['C', { name: 'C' }],
  ]);
  engine.startHand();
  let state = engine.toPublicState('A');
  assert(state.availableActions.isActive, 'A should be active preflop in 3-player hand');
  assert(state.availableActions.canFold, 'active player can fold');
  assert(state.availableActions.canCall, 'A should be facing big blind and can call');
  assert(state.availableActions.canRaise, 'A should be able to raise');
  assert(!state.availableActions.canCheck, 'A cannot check facing a bet');
  assert(state.availableActions.toCall === 20, `A toCall should be 20, got ${state.availableActions.toCall}`);

  engine.applyAction('A', 'call');
  engine.applyAction('B', 'call');
  state = engine.toPublicState('C');
  assert(state.availableActions.isActive, 'C should become active after calls');
  assert(state.availableActions.canCheck, 'big blind can check when action returns');
  assert(!state.availableActions.canBet, 'big blind should not bet while preflop currentBet exists');
}

console.log('全部结算测试通过');
