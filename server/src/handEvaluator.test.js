import { eval5, bestHandScore, compareScore, scoreToHandName, HAND_CATEGORY } from './handEvaluator.js';

function card(rank, suit = 's') {
  return { rank, suit };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const tests = [
  {
    name: '高牌',
    cards: [card(14, 's'), card(12, 'h'), card(9, 'd'), card(6, 'c'), card(3, 's')],
    cat: HAND_CATEGORY.HIGH_CARD,
  },
  {
    name: '一对',
    cards: [card(10, 's'), card(10, 'h'), card(8, 'd'), card(5, 'c'), card(2, 's')],
    cat: HAND_CATEGORY.ONE_PAIR,
  },
  {
    name: '两对',
    cards: [card(11, 's'), card(11, 'h'), card(7, 'd'), card(7, 'c'), card(4, 's')],
    cat: HAND_CATEGORY.TWO_PAIR,
  },
  {
    name: '三条',
    cards: [card(9, 's'), card(9, 'h'), card(9, 'd'), card(5, 'c'), card(2, 's')],
    cat: HAND_CATEGORY.THREE_KIND,
  },
  {
    name: '顺子',
    cards: [card(10, 's'), card(9, 'h'), card(8, 'd'), card(7, 'c'), card(6, 's')],
    cat: HAND_CATEGORY.STRAIGHT,
  },
  {
    name: 'A-5 顺子（轮子）',
    cards: [card(14, 's'), card(5, 'h'), card(4, 'd'), card(3, 'c'), card(2, 's')],
    cat: HAND_CATEGORY.STRAIGHT,
  },
  {
    name: '同花',
    cards: [card(14, 'h'), card(10, 'h'), card(7, 'h'), card(4, 'h'), card(2, 'h')],
    cat: HAND_CATEGORY.FLUSH,
  },
  {
    name: '葫芦',
    cards: [card(8, 's'), card(8, 'h'), card(8, 'd'), card(3, 'c'), card(3, 's')],
    cat: HAND_CATEGORY.FULL_HOUSE,
  },
  {
    name: '四条',
    cards: [card(12, 's'), card(12, 'h'), card(12, 'd'), card(12, 'c'), card(5, 's')],
    cat: HAND_CATEGORY.FOUR_KIND,
  },
  {
    name: '同花顺',
    cards: [card(9, 'd'), card(8, 'd'), card(7, 'd'), card(6, 'd'), card(5, 'd')],
    cat: HAND_CATEGORY.STRAIGHT_FLUSH,
  },
];

for (const t of tests) {
  const score = eval5(t.cards);
  assert(score[0] === t.cat, `${t.name}: expected cat ${t.cat}, got ${score[0]} (${scoreToHandName(score)})`);
  console.log(`✓ ${t.name} → ${scoreToHandName(score)}`);
}

// 7 张选最优：同花不应盖过葫芦
const seven1 = [
  card(8, 's'), card(8, 'h'), card(8, 'd'), card(3, 'c'), card(3, 's'),
  card(14, 's'), card(2, 's'),
];
assert(bestHandScore(seven1)[0] === HAND_CATEGORY.FULL_HOUSE, '7张应选出葫芦');

// 同花 > 顺子
const flush = eval5([card(14, 'c'), card(11, 'c'), card(8, 'c'), card(5, 'c'), card(3, 'c')]);
const straight = eval5([card(10, 's'), card(9, 'h'), card(8, 'd'), card(7, 'c'), card(6, 's')]);
assert(compareScore(flush, straight) > 0, '同花应大于顺子');

console.log('\n全部牌型测试通过');
