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
  constructor(roomId, playerEntries, options = {}) {
    this.roomId = roomId;
    this.order = playerEntries.map(([id, p]) => id);
    this.names = Object.fromEntries(playerEntries.map(([id, p]) => [id, p.name]));
    this.phase = 'waiting';
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.lastRaiseAmount = BIG_BLIND;
    this.dealerIndex = this._initialDealerIndex(options.dealerPlayerId);
    this.smallBlindId = null;
    this.bigBlindId = null;
    this.activeIndex = 0;
    this.lastRaiserId = null;
    this.winners = [];
    this.actionLogs = [];
    this.actionDeadlineAt = null;
    this.actionTimeoutMs = 0;
    this.message = '等待开始新一局';
    this.onlineStatus = {};
    this.seats = {};
    this.startingChipsByPlayerId = options.startingChipsByPlayerId || {};
    for (const id of this.order) {
      this.seats[id] = {
        chips: this.startingChipsByPlayerId[id] ?? START_CHIPS,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        holeCards: [],
        acted: false,
      };
    }
  }

  _initialDealerIndex(dealerPlayerId) {
    if (!dealerPlayerId) return -1;
    const index = this.order.indexOf(dealerPlayerId);
    return index >= 0 ? index : -1;
  }

  getDealerId() {
    return this.order[this.dealerIndex] ?? null;
  }

  _advanceDealer() {
    this.dealerIndex = (this.dealerIndex + 1) % this.order.length;
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
    this.lastRaiseAmount = BIG_BLIND;
    this.winners = [];
    this.actionLogs = [];
    this.actionDeadlineAt = null;
    this.lastRaiserId = null;
    this.message = '新一局开始';

    for (const id of this.order) {
      const s = this.seats[id];
      s.bet = 0;
      s.totalBet = 0;
      s.folded = false;
      s.allIn = false;
      s.acted = false;
      s.holeCards = [this.deck.pop(), this.deck.pop()];
    }

    this._advanceDealer();
    const { smallBlindIndex, bigBlindIndex, firstActorIndex } = this._blindAndFirstActorIndexes();
    this.smallBlindId = this.order[smallBlindIndex];
    this.bigBlindId = this.order[bigBlindIndex];

    this._postBlind(this.smallBlindId, SMALL_BLIND);
    this._log(this.smallBlindId, 'smallBlind', SMALL_BLIND);
    this._postBlind(this.bigBlindId, BIG_BLIND);
    this._log(this.bigBlindId, 'bigBlind', BIG_BLIND);
    this.currentBet = BIG_BLIND;
    this.lastRaiseAmount = BIG_BLIND;
    this.activeIndex = firstActorIndex;
    this._skipUnavailableActors();
    this.message = `${this.names[this.smallBlindId]} 下小盲 ${SMALL_BLIND}，${this.names[this.bigBlindId]} 下大盲 ${BIG_BLIND}`;
    return { ok: true };
  }

  _blindAndFirstActorIndexes() {
    const n = this.order.length;
    if (n === 2) {
      return {
        smallBlindIndex: this.dealerIndex,
        bigBlindIndex: (this.dealerIndex + 1) % n,
        firstActorIndex: this.dealerIndex,
      };
    }
    const smallBlindIndex = (this.dealerIndex + 1) % n;
    const bigBlindIndex = (this.dealerIndex + 2) % n;
    return {
      smallBlindIndex,
      bigBlindIndex,
      firstActorIndex: (bigBlindIndex + 1) % n,
    };
  }

  _log(playerId, action, amount = 0, note = '') {
    this.actionLogs.push({
      phase: this.phase,
      playerId,
      playerName: this.names[playerId] || '',
      action,
      amount,
      note,
    });
    if (this.actionLogs.length > 80) this.actionLogs.shift();
  }

  _activeContenders() {
    return this.order.filter((id) => {
      const seat = this.seats[id];
      return seat && !seat.folded;
    });
  }

  _playersAbleToAct() {
    return this._activeContenders().filter((id) => this._canAct(id));
  }

  _shouldRunOutBoard() {
    return this._activeContenders().length > 1 && this._playersAbleToAct().length === 0;
  }

  _runOutToShowdown() {
    while (this.community.length < 5) {
      if (this.community.length === 0) {
        this.phase = 'flop';
        this._dealCommunity(3);
        this._log(null, 'dealFlop', 0, '自动发 Flop');
      } else if (this.community.length === 3) {
        this.phase = 'turn';
        this._dealCommunity(1);
        this._log(null, 'dealTurn', 0, '自动发 Turn');
      } else if (this.community.length === 4) {
        this.phase = 'river';
        this._dealCommunity(1);
        this._log(null, 'dealRiver', 0, '自动发 River');
      } else {
        break;
      }
    }
    this._showdown();
  }

  _commitChips(playerId, amount) {
    const seat = this.seats[playerId];
    const pay = Math.min(Math.max(0, amount), seat.chips);
    seat.chips -= pay;
    seat.bet += pay;
    seat.totalBet += pay;
    seat.allIn = seat.chips === 0;
    this.pot += pay;
    return pay;
  }

  _postBlind(playerId, amount) {
    this._commitChips(playerId, amount);
  }

  _playersInHand() {
    return this.order.filter((id) => !this.seats[id].folded);
  }

  _canAct(playerId) {
    const seat = this.seats[playerId];
    return seat && !seat.folded && !seat.allIn && seat.chips > 0;
  }

  _skipUnavailableActors() {
    const n = this.order.length;
    for (let i = 0; i < n; i++) {
      const id = this.order[this.activeIndex];
      if (this._canAct(id)) return;
      this.activeIndex = (this.activeIndex + 1) % n;
    }
    this.activeIndex = -1;
  }

  _resetBets() {
    this.currentBet = 0;
    this.lastRaiseAmount = BIG_BLIND;
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
    const alive = this._playersInHand();
    if (alive.length === 1) {
      this._awardPot(alive[0], '其余玩家均已弃牌');
      return;
    }

    this._resetBets();

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this._dealCommunity(3);
      this._log(null, 'dealFlop', 0, '发出 Flop');
      this.message = '翻牌圈 Flop';
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this._dealCommunity(1);
      this._log(null, 'dealTurn', 0, '发出 Turn');
      this.message = '转牌圈 Turn';
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this._dealCommunity(1);
      this._log(null, 'dealRiver', 0, '发出 River');
      this.message = '河牌圈 River';
    } else if (this.phase === 'river') {
      this._showdown();
      return;
    }

    this.activeIndex = this._firstPostFlopActorIndex();
    this._skipUnavailableActors();
    if (this._shouldRunOutBoard()) this._runOutToShowdown();
  }

  _firstPostFlopActorIndex() {
    return this.order.length === 2 ? this.dealerIndex : (this.dealerIndex + 1) % this.order.length;
  }

  _nextIndexFrom(startIndex) {
    const n = this.order.length;
    for (let step = 1; step <= n; step++) {
      const index = (startIndex + step) % n;
      const id = this.order[index];
      const seat = this.seats[id];
      if (this._canAct(id) && (!seat.acted || seat.bet < this.currentBet)) return index;
    }
    return -1;
  }

  _roundComplete() {
    const alive = this._playersInHand();
    if (alive.length <= 1) return true;
    return alive.every((id) => {
      const s = this.seats[id];
      if (s.allIn || s.chips === 0) return true;
      return s.acted && s.bet === this.currentBet;
    });
  }

  _nextActor() {
    const nextIndex = this._nextIndexFrom(this.activeIndex);
    if (nextIndex >= 0) {
      this.activeIndex = nextIndex;
      return this.order[nextIndex];
    }
    if (this._roundComplete()) this._advancePhase();
    return null;
  }

  forceFold(playerId, reason = '离开，视为弃牌') {
    const seat = this.seats[playerId];
    if (!seat || seat.folded) return;
    if (this.phase === 'waiting' || this.phase === 'ended') return;

    seat.folded = true;
    this._log(playerId, 'fold', 0, reason);
    this.message = `${this.names[playerId]} ${reason}`;

    const alive = this._playersInHand();
    if (alive.length === 1) {
      this._awardPot(alive[0], '对手弃牌');
      return;
    }

    if (this.order[this.activeIndex] === playerId) {
      if (this._roundComplete()) this._advancePhase();
      else this._nextActor();
    }
  }

  applyAction(playerId, action, amount = RAISE_STEP) {
    if (!PHASES.includes(this.phase) || this.phase === 'waiting' || this.phase === 'ended' || this.phase === 'showdown') {
      return { ok: false, error: '当前不可操作' };
    }
    if (this.order[this.activeIndex] !== playerId) {
      return { ok: false, error: '还没轮到你' };
    }
    const seat = this.seats[playerId];
    if (seat.folded) return { ok: false, error: '你已弃牌' };
    if (seat.allIn) return { ok: false, error: '你已 All-in' };

    const toCall = Math.max(0, this.currentBet - seat.bet);
    const numericAmount = Number(amount);
    const hasAmount = Number.isFinite(numericAmount);
    const wholeAmount = hasAmount ? Math.floor(numericAmount) : null;

    if (hasAmount && wholeAmount <= 0 && action !== 'allin') {
      return { ok: false, error: '下注金额必须大于 0' };
    }

    if (action === 'fold') {
      seat.folded = true;
      seat.acted = true;
      this._log(playerId, 'fold');
      this.message = `${this.names[playerId]} 弃牌`;
    } else if (action === 'check') {
      if (toCall > 0) return { ok: false, error: '当前需要跟注，不能 Check' };
      seat.acted = true;
      this._log(playerId, 'check');
      this.message = `${this.names[playerId]} Check`;
    } else if (action === 'call') {
      if (toCall <= 0) return { ok: false, error: '当前无需跟注，请 Check 或 Bet' };
      const paid = this._commitChips(playerId, toCall);
      seat.acted = true;
      this._log(playerId, 'call', paid);
      this.message = seat.allIn ? `${this.names[playerId]} All-in 跟注 ${paid}` : `${this.names[playerId]} 跟注 ${paid}`;
    } else if (action === 'bet') {
      if (this.currentBet > 0) return { ok: false, error: '已有下注，请 Call 或 Raise' };
      if (!hasAmount) return { ok: false, error: '请输入下注金额' };
      const minBet = BIG_BLIND;
      const betAmount = wholeAmount;
      if (betAmount < minBet) return { ok: false, error: `最小下注 ${minBet}` };
      if (betAmount > seat.chips) return { ok: false, error: '筹码不足，可选择 All-in' };
      const paid = this._commitChips(playerId, betAmount);
      this.currentBet = seat.bet;
      this.lastRaiseAmount = betAmount;
      this.lastRaiserId = playerId;
      seat.acted = true;
      for (const id of this.order) {
        if (id !== playerId && !this.seats[id].folded && !this.seats[id].allIn) this.seats[id].acted = false;
      }
      this._log(playerId, 'bet', paid);
      this.message = `${this.names[playerId]} 下注 ${paid}`;
    } else if (action === 'raise') {
      if (this.currentBet <= 0) return { ok: false, error: '当前无人下注，请 Bet' };
      if (!hasAmount) return { ok: false, error: '请输入加注金额' };
      const raiseBy = wholeAmount;
      if (raiseBy < this.lastRaiseAmount) return { ok: false, error: `最小加注额 ${this.lastRaiseAmount}` };
      const target = this.currentBet + raiseBy;
      const need = target - seat.bet;
      if (need > seat.chips) return { ok: false, error: '筹码不足，可选择 All-in' };
      const paid = this._commitChips(playerId, need);
      this.currentBet = seat.bet;
      this.lastRaiseAmount = raiseBy;
      this.lastRaiserId = playerId;
      seat.acted = true;
      for (const id of this.order) {
        if (id !== playerId && !this.seats[id].folded && !this.seats[id].allIn) this.seats[id].acted = false;
      }
      this._log(playerId, 'raise', paid, `加注额 ${raiseBy}`);
      this.message = `${this.names[playerId]} 加注 ${raiseBy}，本轮下注到 ${this.currentBet}（补 ${paid}）`;
    } else if (action === 'allin') {
      const beforeBet = seat.bet;
      const paid = this._commitChips(playerId, seat.chips);
      seat.acted = true;
      if (seat.bet > this.currentBet) {
        const raiseDelta = seat.bet - this.currentBet;
        const isFullRaise = raiseDelta >= this.lastRaiseAmount;
        if (isFullRaise) this.lastRaiseAmount = raiseDelta;
        this.currentBet = seat.bet;
        this.lastRaiserId = playerId;
        if (isFullRaise) {
          for (const id of this.order) {
            if (id !== playerId && !this.seats[id].folded && !this.seats[id].allIn) this.seats[id].acted = false;
          }
        }
      }
      this._log(playerId, 'allin', paid);
      this.message = `${this.names[playerId]} All-in ${paid}（${beforeBet} → ${seat.bet}）`;
    } else {
      return { ok: false, error: '未知操作' };
    }

    const alive = this._playersInHand();
    if (alive.length === 1) {
      this._awardPot(alive[0], '对手弃牌');
      return { ok: true };
    }

    if (this._shouldRunOutBoard()) {
      this._runOutToShowdown();
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
    this._log(winnerId, 'win', this.pot, reason);
    this.pot = 0;
    this.phase = 'ended';
    this.message = `${this.names[winnerId]} 赢得 ${this.winners[0].amount}（${reason}）`;
    this.activeIndex = -1;
  }

  _buildSidePots() {
    const invested = this.order
      .map((id) => ({ id, amount: this.seats[id].totalBet }))
      .filter((p) => p.amount > 0)
      .sort((a, b) => a.amount - b.amount);

    const pots = [];
    let previousLevel = 0;
    for (const { amount } of invested) {
      if (amount === previousLevel) continue;
      const contributors = invested.filter((p) => p.amount >= amount).map((p) => p.id);
      const eligible = contributors.filter((id) => !this.seats[id].folded);
      const potAmount = (amount - previousLevel) * contributors.length;
      if (potAmount > 0 && eligible.length > 0) {
        pots.push({ amount: potAmount, contributors, eligible });
      }
      previousLevel = amount;
    }
    return pots;
  }

  _rankPlayers(playerIds) {
    return playerIds.map((id) => {
      const cards = [...this.seats[id].holeCards, ...this.community];
      const score = bestHandScore(cards);
      return {
        id,
        score,
        handName: scoreToHandName(score),
      };
    });
  }

  _settlePotsByShowdown() {
    const sidePots = this._buildSidePots();
    const payouts = new Map();
    const winnerDetails = [];

    for (const pot of sidePots) {
      const ranked = this._rankPlayers(pot.eligible);
      const best = ranked.reduce((top, item) => (compareScore(item.score, top.score) > 0 ? item : top), ranked[0]);
      const winners = ranked.filter((item) => compareScore(item.score, best.score) === 0);
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount % winners.length;

      winners.forEach((winner, index) => {
        const payout = share + (index === 0 ? remainder : 0);
        this.seats[winner.id].chips += payout;
        payouts.set(winner.id, (payouts.get(winner.id) ?? 0) + payout);
        winnerDetails.push({
          id: winner.id,
          name: this.names[winner.id],
          amount: payout,
          handName: winner.handName,
          reason: pot.amount === this.pot ? '主池摊牌' : '边池摊牌',
          potAmount: pot.amount,
          split: winners.length > 1,
        });
      });
    }

    return winnerDetails;
  }

  _showdown() {
    this.phase = 'showdown';
    this._log(null, 'showdown', 0, '摊牌结算');
    this.winners = this._settlePotsByShowdown();
    this.pot = 0;
    this.phase = 'ended';
    this.message = `摊牌：${this.winners.map((w) => `${w.name} +${w.amount}(${w.handName})`).join('、')}`;
    this.activeIndex = -1;
  }

  _availableActionsFor(viewerId) {
    const seat = this.seats[viewerId];
    const activePlayerId = this.activeIndex >= 0 ? this.order[this.activeIndex] : null;
    const minBet = BIG_BLIND;
    const minRaise = this.currentBet > 0 ? this.lastRaiseAmount : BIG_BLIND;
    const toCall = seat ? Math.max(0, this.currentBet - seat.bet) : 0;
    const isActive = Boolean(seat && activePlayerId === viewerId && !this.canStart() && this.phase !== 'showdown');
    const canAct = isActive && !seat.folded && !seat.allIn && seat.chips > 0;

    return {
      isActive,
      toCall,
      minBet,
      minRaise,
      maxAmount: seat?.chips ?? 0,
      canFold: canAct,
      canCheck: canAct && toCall === 0,
      canBet: canAct && toCall === 0 && this.currentBet === 0 && seat.chips >= minBet,
      canCall: canAct && toCall > 0,
      canRaise: canAct && this.currentBet > 0 && seat.chips >= toCall + minRaise,
      canAllIn: canAct && seat.chips > 0,
    };
  }

  toPublicState(viewerId) {
    const revealHole = this.phase === 'showdown' || this.phase === 'ended';
    const availableActions = this._availableActionsFor(viewerId);
    return {
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      activePlayerId: this.activeIndex >= 0 ? this.order[this.activeIndex] : null,
      actionDeadlineAt: this.activeIndex >= 0 && !this.canStart() ? this.actionDeadlineAt : null,
      actionTimeoutMs: this.actionTimeoutMs,
      dealerId: this.order[this.dealerIndex] ?? null,
      smallBlindId: this.smallBlindId,
      bigBlindId: this.bigBlindId,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      minRaise: this.currentBet > 0 ? this.lastRaiseAmount : BIG_BLIND,
      minBet: BIG_BLIND,
      availableActions,
      actionLogs: this.actionLogs.slice(-12),
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
          totalBet: s.totalBet,
          folded: s.folded,
          allIn: s.allIn,
          online: Boolean(this.onlineStatus?.[id] ?? true),
          holeCards,
          isDealer: id === this.order[this.dealerIndex],
          isSmallBlind: id === this.smallBlindId,
          isBigBlind: id === this.bigBlindId,
        };
      }),
    };
  }
}
