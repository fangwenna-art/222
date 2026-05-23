(function initAnimationEvents(global) {
  const ns = global.TexasHoldemAnimation || (global.TexasHoldemAnimation = {});

  /** @type {readonly string[]} */
  const EVENTS = Object.freeze([
    'deal_cards',
    'chip_move',
    'player_turn_change',
    'player_raise',
    'player_call',
    'player_fold',
  ]);

  class AnimationEventBus {
    constructor() {
      /** @type {Map<string, Set<Function>>} */
      this.handlers = new Map();
      /** @type {Set<Function>} */
      this.wildcardHandlers = new Set();
    }

    on(eventName, handler) {
      if (eventName === '*') {
        this.wildcardHandlers.add(handler);
        return () => this.wildcardHandlers.delete(handler);
      }
      if (!EVENTS.includes(eventName)) {
        console.warn(`[AnimationEventBus] unknown event: ${eventName}`);
      }
      if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
      this.handlers.get(eventName).add(handler);
      return () => this.handlers.get(eventName)?.delete(handler);
    }

    /**
     * 唯一入口：触发动画（禁止 UI 层直接调用 play/run）
     * @param {string} eventName
     * @param {object} payload
     */
    emit(eventName, payload = {}) {
      if (!EVENTS.includes(eventName)) {
        console.warn(`[AnimationEventBus] emit ignored unknown event: ${eventName}`);
        return;
      }
      const envelope = {
        eventName,
        payload,
        emittedAt: Date.now(),
      };
      this.handlers.get(eventName)?.forEach((handler) => {
        try {
          handler(envelope);
        } catch (err) {
          console.error(`[AnimationEventBus] handler error (${eventName})`, err);
        }
      });
      this.wildcardHandlers.forEach((handler) => {
        try {
          handler(envelope);
        } catch (err) {
          console.error(`[AnimationEventBus] wildcard handler error (${eventName})`, err);
        }
      });
    }
  }

  ns.EVENTS = EVENTS;
  ns.AnimationEventBus = AnimationEventBus;
})(typeof window !== 'undefined' ? window : globalThis);
