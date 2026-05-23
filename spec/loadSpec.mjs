import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SPEC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function readJson(name) {
  const filePath = path.join(SPEC_DIR, name);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

let cachedSpec = null;

export function loadSpec() {
  if (cachedSpec) return cachedSpec;
  cachedSpec = {
    phases: readJson('phases.json'),
    uiModes: readJson('ui-modes.json'),
    socketEvents: readJson('socket-events.json'),
    timing: readJson('timing.json'),
  };
  return cachedSpec;
}

export function resetSpecCache() {
  cachedSpec = null;
}

export { getHandPhaseIds, getPhaseLabel, isInHandPhase, resolveUiMode, resolveSettingsMode } from './resolveUiMode.mjs';
