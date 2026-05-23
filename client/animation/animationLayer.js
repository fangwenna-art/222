(function initAnimationLayer(global) {
  const ns = global.TexasHoldemAnimation || (global.TexasHoldemAnimation = {});

  function querySeat(playerId) {
    if (!playerId) return null;
    return document.querySelector(`.seat-item[data-seat-id="${CSS.escape(playerId)}"]`);
  }

  function tableOrigin() {
    const deck = document.querySelector('.animation-layer__deck');
    const table = document.querySelector('.poker-table');
    if (!deck || !table) return null;
    const deckRect = deck.getBoundingClientRect();
    return { x: deckRect.left + deckRect.width / 2, y: deckRect.top + deckRect.height / 2 };
  }

  function elementCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function flyToken(from, to, rule, className, label) {
    const layer = document.getElementById('animationLayer');
    if (!layer || !from || !to) return null;

    const token = document.createElement('div');
    token.className = className;
    if (label) token.textContent = label;
    layer.appendChild(token);

    const start = { x: from.x - 14, y: from.y - 18 };
    token.style.left = `${start.x}px`;
    token.style.top = `${start.y}px`;

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const animation = token.animate(
      [
        { transform: 'translate(0, 0) scale(0.72)', opacity: 0.15 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.35}px) scale(0.92)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
      ],
      { duration: rule.duration, easing: rule.easing, fill: 'forwards' },
    );

    animation.onfinish = () => token.remove();
    return animation;
  }

  class AnimationLayer {
    /**
     * @param {import('./animationEvents.js').AnimationEventBus} bus
     * @param {HTMLElement|null} root
     */
    constructor(bus, root) {
      this.bus = bus;
      this.root = root || document.getElementById('animationLayer');
      /** @type {Array<{ eventName: string, payload: object, rule: object }>} */
      this.pending = [];
      this.activeTurnPlayerId = null;
      this.unsubscribers = [];

      ns.EVENTS.forEach((eventName) => {
        this.unsubscribers.push(
          bus.on(eventName, (envelope) => this.enqueue(envelope.eventName, envelope.payload)),
        );
      });
    }

    enqueue(eventName, payload) {
      const rule = ns.getAnimationRule(eventName);
      if (!rule) return;
      this.pending.push({ eventName, payload, rule });
    }

    /** DOM 更新后由 orchestrator 调用，禁止在 render 内调用 */
    syncToDom() {
      const jobs = this.pending.splice(0, this.pending.length);
      jobs.forEach((job) => this.play(job.eventName, job.payload, job.rule));
    }

    play(eventName, payload, rule) {
      switch (rule.animation) {
        case 'deal_fly':
          this.playDealCards(payload, rule);
          break;
        case 'chip_to_pot':
          this.playChipMove(payload, rule);
          break;
        case 'active_highlight':
          this.playTurnChange(payload, rule);
          break;
        case 'bet_stack_bounce':
          this.playBetBounce(payload, rule);
          break;
        case 'fold_fade_rotate':
          this.playFold(payload, rule);
          break;
        default:
          console.warn(`[AnimationLayer] unhandled animation: ${rule.animation}`);
      }
    }

    playDealCards(payload, rule) {
      const origin = tableOrigin();
      if (!origin) return;
      const seatIds = payload.seatIds || [];
      seatIds.forEach((seatId, seatIndex) => {
        const seat = querySeat(seatId);
        if (!seat) return;
        const target = elementCenter(seat);
        const cards = Math.min(payload.cardsPerSeat || 2, 2);
        for (let i = 0; i < cards; i += 1) {
          const offsetOrigin = {
            x: origin.x + (i - 0.5) * 10 + seatIndex * 2,
            y: origin.y + i * 4,
          };
          window.setTimeout(() => {
            flyToken(offsetOrigin, target, rule, 'animation-token animation-token--card', '🂠');
          }, i * 90 + seatIndex * 40);
        }
      });
    }

    playChipMove(payload, rule) {
      const seat = querySeat(payload.playerId);
      const pot = document.querySelector('.table-pot');
      if (!seat || !pot) return;
      const from = elementCenter(seat);
      const to = elementCenter(pot);
      flyToken(from, to, rule, 'animation-token animation-token--chip', payload.amount ? String(payload.amount) : '');
    }

    playTurnChange(payload, rule) {
      if (payload.prevPlayerId && payload.prevPlayerId !== payload.playerId) {
        const prevSeat = querySeat(payload.prevPlayerId);
        prevSeat?.classList.remove('anim-turn-active');
      }
      const seat = querySeat(payload.playerId);
      if (!seat) return;
      seat.classList.add('anim-turn-active');
      this.activeTurnPlayerId = payload.playerId;
      seat.animate(
        [
          { boxShadow: '0 0 0 0 rgba(56, 189, 248, 0)' },
          { boxShadow: '0 0 0 6px rgba(56, 189, 248, 0.45)' },
          { boxShadow: '0 0 0 2px rgba(56, 189, 248, 0.35)' },
        ],
        { duration: rule.duration, easing: rule.easing, fill: 'forwards' },
      );
    }

    playBetBounce(payload, rule) {
      const seat = querySeat(payload.playerId);
      if (!seat) return;
      const stack = seat.querySelector('.bet-stack');
      const target = stack || seat;
      target.classList.remove('anim-bet-bounce');
      void target.offsetWidth;
      target.classList.add('anim-bet-bounce');
      target.style.setProperty('--anim-duration', `${rule.duration}ms`);
      target.style.setProperty('--anim-easing', rule.easing);
      window.setTimeout(() => target.classList.remove('anim-bet-bounce'), rule.duration + 40);
    }

    playFold(payload, rule) {
      const seat = querySeat(payload.playerId);
      if (!seat) return;
      seat.classList.add('anim-fold');
      seat.style.setProperty('--anim-duration', `${rule.duration}ms`);
      seat.style.setProperty('--anim-easing', rule.easing);
      seat.animate(
        [
          { opacity: 1, transform: 'rotate(0deg) scale(1)' },
          { opacity: 0.42, transform: 'rotate(-7deg) scale(0.94)' },
        ],
        { duration: rule.duration, easing: rule.easing, fill: 'forwards' },
      );
    }

    reset() {
      this.pending = [];
      this.activeTurnPlayerId = null;
      document.querySelectorAll('.seat-item.anim-fold, .seat-item.anim-turn-active').forEach((el) => {
        el.classList.remove('anim-fold', 'anim-turn-active');
        el.style.opacity = '';
        el.style.transform = '';
      });
      if (this.root) this.root.innerHTML = '<div class="animation-layer__deck" aria-hidden="true"></div>';
    }

    destroy() {
      this.unsubscribers.forEach((off) => off());
      this.unsubscribers = [];
      this.reset();
    }
  }

  ns.AnimationLayer = AnimationLayer;
})(typeof window !== 'undefined' ? window : globalThis);
