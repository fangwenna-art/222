/**
 * 从 gameState 差分产生 AnimationEvent（纯逻辑，可测试）
 * 禁止在 UI render 中调用 — 仅由 orchestrator 在 state 更新前调用
 */
(function initGameStateBridge(global) {
  const ns = global.TexasHoldemAnimation || (global.TexasHoldemAnimation = {});

  function logKey(log) {
    return `${log.phase}|${log.playerId}|${log.action}|${log.amount}|${log.note || ''}`;
  }

  function handSignature(hand) {
    if (!hand) return '';
    const seatSig = (hand.seats || []).map((s) => `${s.id}:${s.bet}:${s.folded ? 1 : 0}`).join(',');
    return `${hand.phase}|${hand.pot}|${hand.activePlayerId}|${seatSig}`;
  }

  function isNewHand(prevHand, nextHand) {
    if (!nextHand) return false;
    if (!prevHand) return nextHand.phase === 'preflop';
    if (prevHand.phase === 'ended' && nextHand.phase === 'preflop') return true;
    if (prevHand.phase !== 'preflop' && nextHand.phase === 'preflop') return true;
    return false;
  }

  const RAISE_ACTIONS = new Set(['bet', 'raise', 'allin']);

  /**
   * @param {object|null} prevState
   * @param {object|null} nextState
   * @param {{ seenLogKeys?: Set<string>, lastActivePlayerId?: string|null }} cursor
   * @returns {{ events: Array<{ eventName: string, payload: object }>, cursor: object }}
   */
  function detectAnimationEvents(prevState, nextState, cursor = {}) {
    const seenLogKeys = cursor.seenLogKeys || new Set();
    let lastActivePlayerId = cursor.lastActivePlayerId ?? null;
    const events = [];

    const prevHand = prevState?.hand ?? null;
    const nextHand = nextState?.hand ?? null;

    if (!nextHand) {
      return {
        events,
        cursor: { seenLogKeys: new Set(), lastActivePlayerId: null },
      };
    }

    if (isNewHand(prevHand, nextHand)) {
      seenLogKeys.clear();
      lastActivePlayerId = null;
      events.push({
        eventName: 'deal_cards',
        payload: {
          seatIds: (nextHand.seats || []).map((seat) => seat.id),
          cardsPerSeat: 2,
          phase: nextHand.phase,
        },
      });
    }

    const logs = nextHand.actionLogs || [];
    logs.forEach((log) => {
      const key = logKey(log);
      if (seenLogKeys.has(key)) return;
      seenLogKeys.add(key);

      if (log.action === 'fold') {
        events.push({
          eventName: 'player_fold',
          payload: { playerId: log.playerId, playerName: log.playerName, amount: log.amount },
        });
      } else if (log.action === 'call') {
        events.push({
          eventName: 'player_call',
          payload: { playerId: log.playerId, playerName: log.playerName, amount: log.amount },
        });
        events.push({
          eventName: 'chip_move',
          payload: { playerId: log.playerId, amount: log.amount, reason: 'call' },
        });
      } else if (RAISE_ACTIONS.has(log.action)) {
        events.push({
          eventName: 'player_raise',
          payload: {
            playerId: log.playerId,
            playerName: log.playerName,
            amount: log.amount,
            action: log.action,
          },
        });
        events.push({
          eventName: 'chip_move',
          payload: { playerId: log.playerId, amount: log.amount, reason: log.action },
        });
      } else if (log.action === 'smallBlind' || log.action === 'bigBlind') {
        events.push({
          eventName: 'chip_move',
          payload: { playerId: log.playerId, amount: log.amount, reason: log.action },
        });
      }
    });

    if (nextHand.activePlayerId && nextHand.activePlayerId !== lastActivePlayerId) {
      if (nextHand.phase !== 'ended' && nextHand.phase !== 'showdown' && nextHand.phase !== 'waiting') {
        events.push({
          eventName: 'player_turn_change',
          payload: {
            playerId: nextHand.activePlayerId,
            prevPlayerId: lastActivePlayerId,
          },
        });
      }
      lastActivePlayerId = nextHand.activePlayerId;
    }

    if (prevHand && prevHand.phase !== 'ended' && nextHand.phase === 'ended') {
      lastActivePlayerId = null;
    }

    return {
      events,
      cursor: { seenLogKeys, lastActivePlayerId, handSignature: handSignature(nextHand) },
    };
  }

  class GameStateAnimationBridge {
    constructor(bus) {
      this.bus = bus;
      this.cursor = { seenLogKeys: new Set(), lastActivePlayerId: null };
    }

    /**
     * 对比 state 并 emit 动画事件（在 render 之前调用）
     * @param {object|null} prevState
     * @param {object|null} nextState
     */
    process(prevState, nextState) {
      if (!nextState) return;
      const { events, cursor } = detectAnimationEvents(prevState, nextState, this.cursor);
      this.cursor = cursor;
      events.forEach(({ eventName, payload }) => {
        this.bus.emit(eventName, payload);
      });
    }

    reset() {
      this.cursor = { seenLogKeys: new Set(), lastActivePlayerId: null };
    }
  }

  ns.detectAnimationEvents = detectAnimationEvents;
  ns.GameStateAnimationBridge = GameStateAnimationBridge;
})(typeof window !== 'undefined' ? window : globalThis);
