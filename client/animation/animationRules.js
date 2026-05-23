(function initAnimationRules(global) {
  const ns = global.TexasHoldemAnimation || (global.TexasHoldemAnimation = {});

  /**
   * Animation Rules Map — event → animation definition
   * duration: ms | easing: CSS timing-function
   */
  const ANIMATION_RULES = Object.freeze({
    deal_cards: {
      animation: 'deal_fly',
      duration: 620,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
    chip_move: {
      animation: 'chip_to_pot',
      duration: 460,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
    },
    player_turn_change: {
      animation: 'active_highlight',
      duration: 340,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
    player_raise: {
      animation: 'bet_stack_bounce',
      duration: 400,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
    player_call: {
      animation: 'bet_stack_bounce',
      duration: 320,
      easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
    },
    player_fold: {
      animation: 'fold_fade_rotate',
      duration: 440,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
  });

  function getAnimationRule(eventName) {
    return ANIMATION_RULES[eventName] || null;
  }

  ns.ANIMATION_RULES = ANIMATION_RULES;
  ns.getAnimationRule = getAnimationRule;
})(typeof window !== 'undefined' ? window : globalThis);
