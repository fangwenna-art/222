const IN_HAND_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);

export function buildPhaseIndex(phasesSpec) {
  const byId = new Map();
  for (const phase of phasesSpec?.handPhases || []) {
    byId.set(phase.id, phase);
  }
  return byId;
}

export function getHandPhaseIds(phasesSpec) {
  return (phasesSpec?.handPhases || []).map((phase) => phase.id);
}

export function getPhaseLabel(phasesSpec, phaseId) {
  const phase = buildPhaseIndex(phasesSpec).get(phaseId);
  return phase?.label || phaseId || '—';
}

export function isInHandPhase(handPhase) {
  return IN_HAND_PHASES.has(handPhase);
}

export function getSettingsHandPhase(hand) {
  return hand?.phase ?? 'lobby';
}

export function isSettingsEditable(gameState, hand) {
  if (!gameState) return false;
  if (gameState.canEditSettings) return true;
  if (!hand) return true;
  const phase = hand.phase;
  return phase === 'waiting' || phase === 'ended' || phase === 'showdown';
}

export function resolveSettingsMode(gameState, hand, viewerPlayerId) {
  if (!gameState?.hostPlayerId) return 'readonly';
  if (!viewerPlayerId || gameState.hostPlayerId !== viewerPlayerId) return 'readonly';
  if (isSettingsEditable(gameState, hand)) return 'edit';
  return 'locked';
}

export function resolveUiMode(gameState, options = {}) {
  const screen = options.screen || 'room';
  const phasesSpec = options.phasesSpec;
  const uiModesSpec = options.uiModesSpec;

  if (screen === 'entry') {
    const entryMode = (uiModesSpec?.modes || []).find((mode) => mode.id === 'entry');
    return {
      mode: 'entry',
      screen: 'entry',
      handNull: true,
      handPhase: 'lobby',
      inHand: false,
      isShowdown: false,
      isEnded: false,
      isSpectating: false,
      settingsMode: 'readonly',
      phaseLabel: entryMode?.label || '进入牌桌前',
      flags: { ...(entryMode?.flags || {}) },
    };
  }

  const hand = gameState?.hand ?? null;
  const viewer = gameState?.viewer ?? null;
  const handPhase = hand?.phase ?? null;
  const handNull = hand === null;
  const inHand = Boolean(hand && isInHandPhase(handPhase));
  const isShowdown = handPhase === 'showdown';
  const isEnded = handPhase === 'ended';
  const isSpectating = Boolean(viewer?.isSpectating);

  let modeId = 'room_lobby';
  if (handNull || handPhase === 'waiting') modeId = 'room_lobby';
  else if (inHand) modeId = 'room_in_hand';
  else if (isShowdown) modeId = 'room_showdown';
  else if (isEnded) modeId = 'room_ended';

  const modeDef = (uiModesSpec?.modes || []).find((mode) => mode.id === modeId);
  const settingsHandPhase = getSettingsHandPhase(hand);
  const settingsMode = resolveSettingsMode(gameState, hand, options.viewerPlayerId);

  let phaseLabel = modeDef?.flags?.phaseLabel;
  if (!phaseLabel && handPhase) phaseLabel = getPhaseLabel(phasesSpec, handPhase);
  if (!phaseLabel) phaseLabel = modeDef?.flags?.phaseLabel || modeDef?.label || '大厅';

  return {
    mode: modeId,
    screen: 'room',
    handNull,
    handPhase: settingsHandPhase,
    serverHandPhase: handPhase,
    inHand,
    isShowdown,
    isEnded,
    isSpectating,
    settingsMode,
    phaseLabel,
    flags: { ...(modeDef?.flags || {}) },
  };
}

export { IN_HAND_PHASES };
