import { bestHandScore, compareScore, scoreToHandName } from './handEvaluator.js';

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ['s', 'h', 'd', 'c'];
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

const START_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const RAISE_STEP = 20;

const PHASES = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown', 'ended'];

function cardLabel(card) {
  const r = RANK_LABEL[card.rank] ?? String(card.rank);
  const s = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit];
  return `${r}${s}`;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

export class GameEngine {
  constructor(roomId, playerEntries) {
    this.roomId = roomId;
    this.order = playerEntries.map(([id, p]) => id);
    this.names = Object.fromEntries(playerEntries.map(([id, p]) => [id, p.name]));
    this.phase = 'waiting';
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.dealerIndex = -1;
    this.activeIndex = 0;
    this.lastRaiserId = null;
    this.winners = [];
    this.message = '等待开始新一局';
    this.onlineStatus = {};
    this.seats = {};
    for (const id of this.order) {
      this.seats[id] = {
        chips: START_CHIPS,
        bet: 0,
        folded: false,
        holeCards: [],
        acted: false,
      };
    }
  }

  canStart() {
    return this.phase === 'waiting' || this.phase === 'ended';
  }

  startHand() {
    const active = this.order.filter((id) => this.seats[id].chips > 0);
    if (active.length < 2) {
      return { ok: false, error: '至少需要 2 名有筹码的玩家' };
    }
    this.order = active;
    this.phase = 'preflop';
    this.deck = makeDeck();
    shuffle(this.deck);
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.winners = [];
    this.lastRaiserId = null;
    this.message = '新一局开始';

    for (const id of this.order) {
      const s = this.seats[id];
      s.bet = 0;
      s.folded = false;
      s.acted = false;
      s.holeCards = [this.deck.pop(), this.deck.pop()];
    }

    this.dealerIndex = (this.dealerIndex + 1) % this.order.length;
    const sbIdx = (this.dealerIndex + 1) % this.order.length;
    const bbIdx = (this.dealerIndex + 2) % this.order.length;
    this._postBlind(this.order[sbIdx], SMALL_BLIND);
    this._postBlind(this.order[bbIdx], BIG_BLIND);
    this.currentBet = BIG_BLIND;
    this.activeIndex = (bbIdx + 1) % this.order.length;
    this._skipFolded();
    return { ok: true };
  }

  _postBlind(playerId, amount) {
    const seat = this.seats[playerId];
    const pay = Math.min(amount, seat.chips);
    seat.chips -= pay;
    seat.bet += pay;
    this.pot += pay;
  }

  _activeIds() {
    return this.order.filter((id) => !this.seats[id].folded && this.seats[id].chips >= 0);
  }

  _notFoldedIds() {
    return this.order.filter((id) => !this.seats[id].folded);
  }

  _skipFolded() {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      const id = this.order[this.activeIndex];
      if (!this.seats[id].folded && this.seats[id].chips > 0) return;
      this.activeIndex = (this.activeIndex + 1) % n;
    }
  }

  _resetBets() {
    this.currentBet = 0;
    this.lastRaiserId = null;
    for (const id of this.order) {
      this.seats[id].bet = 0;
      this.seats[id].acted = false;
    }
  }

  _dealCommunity(count) {
    for (let i = 0; i < count; i++) this.community.push(this.deck.pop());
  }

  _advancePhase() {
    const alive = this._notFoldedIds();
    if (alive.length === 1) {
      this._awardPot(alive[0], '其余玩家均已弃牌');
      return;
    }

    this._resetBets();

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this._dealCommunity(3);
      this.message = '翻牌圈 Flop';
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this._dealCommunity(1);
      this.message = '转牌圈 Turn';
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this._dealCommunity(1);
      this.message = '河牌圈 River';
    } else if (this.phase === 'river') {
      this._showdown();
      return;
    }

    this.activeIndex = (this.dealerIndex + 1) % this.order.length;
    this._skipFolded();
  }

  _roundComplete() {
    const alive = this._notFoldedIds();
    if (alive.length <= 1) return true;
    return alive.every((id) => {
      const s = this.seats[id];
      if (s.chips === 0) return true;
      return s.acted && s.bet === this.currentBet;
    });
  }

  _nextActor() {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      this.activeIndex = (this.activeIndex + 1) % n;
      const id = this.order[this.activeIndex];
      const s = this.seats[id];
      if (!s.folded && s.chips > 0 && (!s.acted || s.bet < this.currentBet)) return id;
    }
    if (this._roundComplete()) this._advancePhase();
    return null;
  }

  forceFold(playerId) {
    const seat = this.seats[playerId];
    if (!seat || seat.folded) return;
    if (this.phase === 'waiting' || this.phase === 'ended') return;

    seat.folded = true;
    this.message = `${this.names[playerId]} 离开，视为弃牌`;

    const alive = this._notFoldedIds();
    if (alive.length === 1) {
      this._awardPot(alive[0], '对手弃牌');
      return;
    }

    if (this.order[this.activeIndex] === playerId) {
      if (this._roundComplete()) this._advancePhase();
      else this._nextActor();
    }
  }

  applyAction(playerId, action, raiseAmount) {
    if (!PHASES.includes(this.phase) || this.phase === 'waiting' || this.phase === 'ended' || this.phase === 'showdown') {
      return { ok: false, error: '当前不可操作' };
    }
    if (this.order[this.activeIndex] !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    const seat = this.seats[playerId];
    if (seat.folded) return { ok: false, error: '你已弃牌' };

    if (action === 'fold') {
      seat.folded = true;
      seat.acted = true;
      this.message = `${this.names[playerId]} 弃牌`;
    } else if (action === 'call') {
      const need = this.currentBet - seat.bet;
      if (need <= 0) {
        seat.acted = true;
        this.message = `${this.names[playerId]} 过牌`;
      } else {
        const pay = Math.min(need, seat.chips);
        seat.chips -= pay;
        seat.bet += pay;
        this.pot += pay;
        seat.acted = true;
        this.message = `${this.names[playerId]} 跟注 ${pay}`;
      }
    } else if (action === 'raise') {
      const target = Math.max(this.currentBet + RAISE_STEP, seat.bet + (raiseAmount || RAISE_STEP));
      const need = target - seat.bet;
      if (need > seat.chips) {
        return { ok: false, error: '筹码不足' };
      }
      seat.chips -= need;
      seat.bet = target;
      this.pot += need;
      this.currentBet = target;
      this.lastRaiserId = playerId;
      seat.acted = true;
      for (const id of this.order) {
        if (id !== playerId && !this.seats[id].folded) this.seats[id].acted = false;
      }
      this.message = `${this.names[playerId]} 加注至 ${target}`;
    } else {
      return { ok: false, error: '未知操作' };
    }

    const alive = this._notFoldedIds();
    if (alive.length === 1) {
      this._awardPot(alive[0], '对手弃牌');
      return { ok: true };
    }

    if (this._roundComplete()) {
      this._advancePhase();
      return { ok: true };
    }

    this._nextActor();
    return { ok: true };
  }

  _awardPot(winnerId, reason) {
    const seat = this.seats[winnerId];
    seat.chips += this.pot;
    this.winners = [{ id: winnerId, name: this.names[winnerId], amount: this.pot, reason }];
    this.pot = 0;
    this.phase = 'ended';
    this.message = `${this.names[winnerId]} 赢得 ${this.winners[0].amount}（${reason}）`;
    this.activeIndex = -1;
  }

  _showdown() {
    this.phase = 'showdown';
    const alive = this._notFoldedIds();
    let best = null;
    const results = [];

    for (const id of alive) {
      const cards = [...this.seats[id].holeCards, ...this.community];
      const score = bestHandScore(cards);
      const handName = scoreToHandName(score);
      results.push({ id, score, handName });
      if (!best || compareScore(score, best.score) > 0) {
        best = { id, score, handName };
      }
    }

    const top = results.filter((r) => compareScore(r.score, best.score) === 0);
    const share = Math.floor(this.pot / top.length);
    this.winners = top.map((r) => {
      this.seats[r.id].chips += share;
      return {
        id: r.id,
        name: this.names[r.id],
        amount: share,
        handName: r.handName,
        reason: '摊牌比牌',
      };
    });
    this.pot = 0;
    this.phase = 'ended';
    this.message = `摊牌：${this.winners.map((w) => `${w.name}(${w.handName})`).join('、')} 获胜`;
    this.activeIndex = -1;
  }

  toPublicState(viewerId) {
    const revealHole = this.phase === 'showdown' || this.phase === 'ended';
    return {
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      activePlayerId: this.activeIndex >= 0 ? this.order[this.activeIndex] : null,
      dealerId: this.order[this.dealerIndex] ?? null,
      communityCards: this.community.map(cardLabel),
      message: this.message,
      winners: this.winners,
      canStart: this.canStart(),
      seats: this.order.map((id) => {
        const s = this.seats[id];
        let holeCards = null;
        if (s.holeCards.length) {
          if (revealHole || id === viewerId) {
            holeCards = s.holeCards.map(cardLabel);
          } else {
            holeCards = ['🂠', '🂠'];
          }
        }
        return {
          id,
          name: this.names[id],
          chips: s.chips,
          bet: s.bet,
          folded: s.folded,
          online: Boolean(this.onlineStatus?.[id] ?? true),
          holeCards,
          isDealer: id === this.order[this.dealerIndex],
        };
      }),
    };
  }
}
