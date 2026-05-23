import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANIM = path.join(ROOT, 'client/animation');

function loadInSandbox(file) {
  const code = fs.readFileSync(path.join(ANIM, file), 'utf8');
  const context = { window: {}, console, setTimeout, clearTimeout, CSS: { escape: (s) => s } };
  vm.runInContext(code, vm.createContext(context));
  return context.window.TexasHoldemAnimation;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const eventsNs = loadInSandbox('animationEvents.js');
const rulesNs = loadInSandbox('animationRules.js');
const bridgeNs = loadInSandbox('gameStateBridge.js');

const { detectAnimationEvents } = bridgeNs;
const { ANIMATION_RULES } = rulesNs;
const { EVENTS } = eventsNs;

assert(EVENTS.length === 6, 'expected 6 animation events');
for (const name of EVENTS) {
  assert(ANIMATION_RULES[name], `missing rule for ${name}`);
  assert(ANIMATION_RULES[name].duration > 0, `${name} needs duration`);
  assert(ANIMATION_RULES[name].easing, `${name} needs easing`);
}

const baseHand = {
  phase: 'preflop',
  pot: 30,
  activePlayerId: 'a',
  actionLogs: [],
  seats: [{ id: 'a', bet: 10 }, { id: 'b', bet: 20 }],
};

const deal = detectAnimationEvents(null, { hand: baseHand }, {});
assert(deal.events.some((e) => e.eventName === 'deal_cards'), 'new hand should emit deal_cards');

const withFold = detectAnimationEvents(
  { hand: { ...baseHand, actionLogs: [] } },
  {
    hand: {
      ...baseHand,
      actionLogs: [{ phase: 'preflop', playerId: 'b', playerName: 'B', action: 'fold', amount: 0 }],
    },
  },
  deal.cursor,
);
assert(withFold.events.some((e) => e.eventName === 'player_fold'), 'fold log should emit player_fold');

console.log('全部 Animation Layer 测试通过');
