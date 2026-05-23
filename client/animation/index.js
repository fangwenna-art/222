(function initAnimationSystem(global) {
  const ns = global.TexasHoldemAnimation || (global.TexasHoldemAnimation = {});

  let bus = null;
  let layer = null;
  let bridge = null;

  function create(options = {}) {
    destroy();
    bus = new ns.AnimationEventBus();
    layer = new ns.AnimationLayer(bus, options.root || document.getElementById('animationLayer'));
    bridge = new ns.GameStateAnimationBridge(bus);
    return { bus, layer, bridge, emit: (name, payload) => bus.emit(name, payload) };
  }

  function destroy() {
    layer?.destroy();
    bus = null;
    layer = null;
    bridge = null;
  }

  /**
   * State 更新编排：先 diff emit，再 render UI，最后 flush 动画到 DOM
   * @param {object|null} prevState
   * @param {object|null} nextState
   * @param {Function} renderFn
   */
  function orchestrateStateUpdate(prevState, nextState, renderFn) {
    if (!bridge || !layer) return renderFn?.(nextState);
    bridge.process(prevState, nextState);
    renderFn?.(nextState);
    layer.syncToDom();
  }

  ns.create = create;
  ns.destroy = destroy;
  ns.orchestrateStateUpdate = orchestrateStateUpdate;
  ns.getBus = () => bus;
  ns.getLayer = () => layer;
  ns.getBridge = () => bridge;
})(typeof window !== 'undefined' ? window : globalThis);
