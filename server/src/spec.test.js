import { loadSpec, getHandPhaseIds } from '../../spec/loadSpec.mjs';
import { resolveUiMode, isInHandPhase } from '../../spec/resolveUiMode.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const spec = loadSpec();
const phaseIds = getHandPhaseIds(spec.phases);

assert(spec.phases.version === 1, 'phases.json version should be 1');
assert(spec.uiModes.version === 1, 'ui-modes.json version should be 1');
assert(phaseIds.length === 7, `expected 7 hand phases, got ${phaseIds.length}`);
assert(phaseIds.includes('showdown') && phaseIds.includes('ended'), 'phases should include showdown and ended');

for (const phase of spec.phases.handPhases) {
  assert(typeof phase.label === 'string' && phase.label.length > 0, `phase ${phase.id} needs label`);
  assert(typeof phase.gates.canStart === 'boolean', `phase ${phase.id} needs canStart gate`);
  assert(typeof phase.gates.canConfigureRoom === 'boolean', `phase ${phase.id} needs canConfigureRoom gate`);
  assert(phase.inHand === isInHandPhase(phase.id), `phase ${phase.id} inHand mismatch`);
}

const modeIds = new Set(spec.uiModes.modes.map((mode) => mode.id));
for (const required of ['entry', 'room_lobby', 'room_in_hand', 'room_showdown', 'room_ended']) {
  assert(modeIds.has(required), `ui-modes missing ${required}`);
}

{
  const lobby = resolveUiMode({ hand: null, canEditSettings: true, hostPlayerId: 'h1' }, {
    phasesSpec: spec.phases,
    uiModesSpec: spec.uiModes,
    viewerPlayerId: 'h1',
  });
  assert(lobby.mode === 'room_lobby', `lobby mode expected room_lobby, got ${lobby.mode}`);
  assert(lobby.handPhase === 'lobby', 'lobby should use pseudo handPhase lobby');
  assert(lobby.flags.showStartButton === true, 'lobby should show start button');
}

{
  const inHand = resolveUiMode({
    hand: { phase: 'flop', canStart: false },
    canEditSettings: false,
    hostPlayerId: 'h1',
  }, { phasesSpec: spec.phases, uiModesSpec: spec.uiModes, viewerPlayerId: 'p1' });
  assert(inHand.mode === 'room_in_hand', `in-hand mode expected room_in_hand, got ${inHand.mode}`);
  assert(inHand.inHand === true, 'flop should be inHand');
  assert(inHand.settingsMode === 'readonly', 'guest in-hand settings should be readonly');
}

{
  const ended = resolveUiMode({
    hand: { phase: 'ended', canStart: true },
    canEditSettings: true,
    hostPlayerId: 'h1',
  }, { phasesSpec: spec.phases, uiModesSpec: spec.uiModes, viewerPlayerId: 'h1' });
  assert(ended.mode === 'room_ended', `ended mode expected room_ended, got ${ended.mode}`);
  assert(ended.settingsMode === 'edit', 'host between hands should edit settings');
  assert(ended.flags.delayResultPanelMs === spec.timing.constants.RESULT_PANEL_DELAY_MS.default, 'ended should expose result delay');
}

{
  const showdown = resolveUiMode({
    hand: { phase: 'showdown', canStart: false },
    canEditSettings: true,
    hostPlayerId: 'h1',
  }, { phasesSpec: spec.phases, uiModesSpec: spec.uiModes, viewerPlayerId: 'h1' });
  assert(showdown.mode === 'room_showdown', `showdown mode expected room_showdown, got ${showdown.mode}`);
  assert(showdown.flags.revealHoleCards === true, 'showdown should reveal hole cards flag');
}

assert(
  spec.timing.constants.SHOWDOWN_PAUSE_MS.default === 1800,
  'showdown pause default should match server default',
);

console.log('全部规范与状态映射测试通过');
