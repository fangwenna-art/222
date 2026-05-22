/**
 * 标准德州扑克 5 张牌型评估（从 7 张中选最优 5 张）
 * 牌型等级：高牌 < 一对 < 两对 < 三条 < 顺子 < 同花 < 葫芦 < 四条 < 同花顺
 */

export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

export const HAND_NAMES = {
  [HAND_CATEGORY.HIGH_CARD]: '高牌',
  [HAND_CATEGORY.ONE_PAIR]: '一对',
  [HAND_CATEGORY.TWO_PAIR]: '两对',
  [HAND_CATEGORY.THREE_KIND]: '三条',
  [HAND_CATEGORY.STRAIGHT]: '顺子',
  [HAND_CATEGORY.FLUSH]: '同花',
  [HAND_CATEGORY.FULL_HOUSE]: '葫芦',
  [HAND_CATEGORY.FOUR_KIND]: '四条',
  [HAND_CATEGORY.STRAIGHT_FLUSH]: '同花顺',
};

/** @param {number[]} a @param {number[]} b */
export function compareScore(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** @param {{ rank: number, suit: string }[]} cards */
function rankGroups(cards) {
  const counts = new Map();
  for (const { rank } of cards) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

/** @param {{ rank: number, suit: string }[]} cards */
function isFlush(cards) {
  const suit = cards[0].suit;
  return cards.every((c) => c.suit === suit);
}

/**
 * 5 张牌是否为顺子，返回顺子最大牌点数（A-2-3-4-5 视为 5 高）
 * @param {{ rank: number }[]} cards - 恰好 5 张
 */
function straightHigh(cards) {
  const unique = [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a);
  if (unique.length !== 5) return 0;

  if (unique[0] - unique[4] === 4) return unique[0];

  // _wheel_: A(14) - 5 - 4 - 3 - 2
  if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
    return 5;
  }

  return 0;
}

/**
 * 评估恰好 5 张牌，返回可比较的 score 数组
 * @param {{ rank: number, suit: string }[]} cards
 * @returns {number[]}
 */
export function eval5(cards) {
  if (cards.length !== 5) {
    throw new Error('eval5 requires exactly 5 cards');
  }

  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const groups = rankGroups(cards);
  const flush = isFlush(cards);
  const straight = straightHigh(cards);

  if (flush && straight) {
    return [HAND_CATEGORY.STRAIGHT_FLUSH, straight];
  }

  if (groups[0].count === 4) {
    const kicker = groups[1].rank;
    return [HAND_CATEGORY.FOUR_KIND, groups[0].rank, kicker];
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return [HAND_CATEGORY.FULL_HOUSE, groups[0].rank, groups[1].rank];
  }

  if (flush) {
    return [HAND_CATEGORY.FLUSH, ...ranksDesc];
  }

  if (straight) {
    return [HAND_CATEGORY.STRAIGHT, straight];
  }

  if (groups[0].count === 3) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.rank);
    return [HAND_CATEGORY.THREE_KIND, groups[0].rank, ...kickers];
  }

  if (groups[0].count === 2 && groups[1]?.count === 2) {
    const pairRanks = groups
      .filter((g) => g.count === 2)
      .map((g) => g.rank)
      .sort((a, b) => b - a);
    const kicker = groups.find((g) => g.count === 1)?.rank ?? 0;
    return [HAND_CATEGORY.TWO_PAIR, pairRanks[0], pairRanks[1], kicker];
  }

  if (groups[0].count === 2) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.rank);
    return [HAND_CATEGORY.ONE_PAIR, groups[0].rank, ...kickers];
  }

  return [HAND_CATEGORY.HIGH_CARD, ...ranksDesc];
}

function popcount(mask) {
  let n = 0;
  let m = mask;
  while (m) {
    n += m & 1;
    m >>= 1;
  }
  return n;
}

/**
 * 从 5~7 张牌中选出标准德州最优 5 张
 * @param {{ rank: number, suit: string }[]} cards
 * @returns {number[]}
 */
export function bestHandScore(cards) {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('bestHandScore expects 5 to 7 cards');
  }

  if (cards.length === 5) {
    return eval5(cards);
  }

  let best = null;
  const n = cards.length;
  const limit = 1 << n;

  for (let mask = 0; mask < limit; mask++) {
    if (popcount(mask) !== 5) continue;
    const hand = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) hand.push(cards[i]);
    }
    const score = eval5(hand);
    if (!best || compareScore(score, best) > 0) best = score;
  }

  return best;
}

/** @param {number[]} score */
export function scoreToHandName(score) {
  const category = score[0];
  return HAND_NAMES[category] ?? '高牌';
}

/**
 * @param {{ rank: number, suit: string }[]} cards - 5~7 张
 */
export function evaluateHand(cards) {
  const score = bestHandScore(cards);
  return {
    score,
    name: scoreToHandName(score),
    category: score[0],
  };
}
