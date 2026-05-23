function resolveServerUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('server')) return params.get('server');

  const { protocol, hostname, port } = window.location;

  // 分离静态页（5188/5173）+ 独立 socket 服务（3010）
  if (port === '5173' || port === '5188') {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3010';
    }
    return `${protocol}//${hostname}:3010`;
  }

  // 一体服务：npm start（3001/3010）或线上 HTTPS，socket 与页面同源
  if (protocol === 'https:' || protocol === 'http:') {
    return window.location.origin;
  }

  return 'http://localhost:3001';
}

const SERVER_URL = resolveServerUrl();
const SESSION_KEY = 'texas-holdem-session';
const PROFILE_KEY = 'texas-holdem-player-name';
const PHASE_LABEL = {
  waiting: '等待开始',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  ended: '局结束',
};

const $ = (id) => document.getElementById(id);

const els = {
  connectionStatus: $('connectionStatus'),
  serverUrl: $('serverUrl'),
  playerName: $('playerName'),
  roomId: $('roomId'),
  btnCreate: $('btnCreate'),
  btnJoin: $('btnJoin'),
  message: $('message'),
  roomPanel: $('roomPanel'),
  currentRoomId: $('currentRoomId'),
  roomPlayerSummary: $('roomPlayerSummary'),
  lobbyCard: $('lobbyCard'),
  bottomDock: $('bottomDock'),
  gamePhase: $('gamePhase'),
  gamePot: $('gamePot'),
  tablePotLabel: $('tablePotLabel'),
  gameMessage: $('gameMessage'),
  actionTimer: $('actionTimer'),
  presenceBanner: $('presenceBanner'),
  waitingPlayersBox: $('waitingPlayersBox'),
  waitingPlayersList: $('waitingPlayersList'),
  tableMessage: $('tableMessage'),
  mySeatPanel: $('mySeatPanel'),
  mySeatName: $('mySeatName'),
  mySeatMeta: $('mySeatMeta'),
  myCards: $('myCards'),
  communityCards: $('communityCards'),
  seatList: $('seatList'),
  resultPanel: $('resultPanel'),
  btnToggleResult: $('btnToggleResult'),
  resultKicker: $('resultKicker'),
  resultLatest: $('resultLatest'),
  resultPanelBody: $('resultPanelBody'),
  resultSummaryList: $('resultSummaryList'),
  resultLogKicker: $('resultLogKicker'),
  resultLogList: $('resultLogList'),
  handHistoryBox: $('handHistoryBox'),
  handHistoryList: $('handHistoryList'),
  chipStatsBox: $('chipStatsBox'),
  chipStatsList: $('chipStatsList'),
  roomBlindsLabel: $('roomBlindsLabel'),
  roomSettingsBox: $('roomSettingsBox'),
  btnToggleSettings: $('btnToggleSettings'),
  roomSettingsBody: $('roomSettingsBody'),
  roomSettingsSummary: $('roomSettingsSummary'),
  roomSettingsStatus: $('roomSettingsStatus'),
  roomSettingsHelp: $('roomSettingsHelp'),
  roomSettingsDisplay: $('roomSettingsDisplay'),
  roomSettingsForm: $('roomSettingsForm'),
  roomSettingsError: $('roomSettingsError'),
  displayStartingChips: $('displayStartingChips'),
  displaySmallBlind: $('displaySmallBlind'),
  displayBigBlind: $('displayBigBlind'),
  settingStartingChips: $('settingStartingChips'),
  settingSmallBlind: $('settingSmallBlind'),
  settingBigBlind: $('settingBigBlind'),
  btnPresetBlinds1020: $('btnPresetBlinds1020'),
  btnPresetBlinds2550: $('btnPresetBlinds2550'),
  btnCancelSettings: $('btnCancelSettings'),
  btnSaveSettings: $('btnSaveSettings'),
  btnStartHand: $('btnStartHand'),
  actionBar: $('actionBar'),
  actionHint: $('actionHint'),
  btnLeaveRoom: $('btnLeaveRoom'),
  betAmount: $('betAmount'),
  btnHalfPot: $('btnHalfPot'),
  btnPot: $('btnPot'),
  btnDouble: $('btnDouble'),
  btnTriple: $('btnTriple'),
  btnAmountToggle: $('btnAmountToggle'),
  btnFold: $('btnFold'),
  btnCheck: $('btnCheck'),
  btnBet: $('btnBet'),
  btnCall: $('btnCall'),
  btnRaise: $('btnRaise'),
  btnAllIn: $('btnAllIn'),
  allInConfirm: $('allInConfirm'),
  allInConfirmText: $('allInConfirmText'),
  btnCancelAllIn: $('btnCancelAllIn'),
  btnConfirmAllIn: $('btnConfirmAllIn'),
};

if (els.serverUrl) els.serverUrl.textContent = SERVER_URL;

const socket = io(SERVER_URL, {
  transports: window.location.protocol === 'https:' ? ['polling', 'websocket'] : ['websocket', 'polling'],
  reconnection: true,
});

let currentSession = loadSession();
let myPlayerId = currentSession?.playerId || null;
let currentPlayerName = currentSession?.playerName || window.localStorage.getItem(PROFILE_KEY) || '';
let betPanelOpen = false;
let resultPanelOpen = false;
let lastHandResultSignature = '';
let lastRenderedHandPhase = null;
let dockResizeObserver = null;
let startHandPending = false;
let settingsSavePending = false;
let roomSettingsEditing = false;
let lastSyncedSettingsSnap = '';
let lastSettingsMode = null;
let lastSettingsHandPhase = null;
let settingsPanelExpanded = false;
let settingsExpandedManual = false;
let settingsEverSaved = false;
let sessionResuming = false;
let resumeNoticeUntil = 0;
let socketConnected = false;

const IN_HAND_PHASES = new Set(['preflop', 'flop', 'turn', 'river']);
const SETTINGS_MOBILE_MQL = window.matchMedia('(max-width: 520px)');

const SETTINGS_MODE = {
  EDIT: 'edit',
  LOCKED: 'locked',
  READONLY: 'readonly',
};

const SETTINGS_LIMITS = {
  startingChips: { min: 100, max: 100000 },
  smallBlind: { min: 1, max: 5000 },
  bigBlind: { min: 2, max: 10000 },
};
let resultPanelRevealTimer = null;
let resultPanelDelayUntil = 0;

const RESULT_PANEL_DELAY_MS = 3000;

function clearResultPanelRevealTimer() {
  if (resultPanelRevealTimer) {
    clearTimeout(resultPanelRevealTimer);
    resultPanelRevealTimer = null;
  }
}

function scheduleResultPanelReveal() {
  clearResultPanelRevealTimer();
  const delay = Math.max(0, resultPanelDelayUntil - Date.now());
  resultPanelRevealTimer = setTimeout(() => {
    resultPanelRevealTimer = null;
    const hand = getCurrentHand();
    if (hand?.phase === 'ended') {
      renderResultPanel(hand);
      maybeScrollResultIntoView();
    }
  }, delay);
}

function resetResultPanelTiming() {
  clearResultPanelRevealTimer();
  resultPanelDelayUntil = 0;
  resultPanelOpen = false;
  lastHandResultSignature = '';
  resetStartHandPending();
}

function updateLayoutMetrics() {
  const dockHeight = els.bottomDock.hidden ? 0 : Math.ceil(els.bottomDock.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--dock-height', `${dockHeight}px`);
  document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
}

function loadSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function handResultSignature(hand) {
  if (hand?.phase !== 'ended') return '';
  return `${hand.message}|${(hand.winners || []).map((winner) => `${winner.id}:${winner.amount}:${winner.reason}`).join(',')}`;
}

function setScreen(screen) {
  const isRoom = screen === 'room';
  els.lobbyCard.hidden = isRoom;
  els.roomPanel.hidden = !isRoom;
  document.body.classList.toggle('room-active', isRoom);
}

function setEntryMode() {
  setScreen('entry');
  if (currentPlayerName) els.playerName.value = currentPlayerName;
}

function savePlayerName(name) {
  currentPlayerName = String(name || '').trim();
  if (currentPlayerName) window.localStorage.setItem(PROFILE_KEY, currentPlayerName);
}

function saveSession(session) {
  currentSession = session;
  myPlayerId = session?.playerId || null;
  if (session) {
    if (session.playerName) savePlayerName(session.playerName);
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

function rememberSession(res) {
  if (res?.session) {
    saveSession(res.session);
    if (res.session.playerName) savePlayerName(res.session.playerName);
    if (res.session.roomId) els.roomId.value = res.session.roomId;
  }
}

function setStatus(text, type = 'offline') {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `badge connection-badge badge--${type}`;
}

function setMessage(text, type = '') {
  els.message.textContent = text;
  els.message.className = `message${type ? ` message--${type}` : ''}`;
}

function countOnlinePlayers(players) {
  return (players || []).filter((player) => player.online !== false).length;
}

function countStartEligiblePlayers(players) {
  return (players || []).filter((player) => player.online !== false && (player.chips == null || player.chips > 0)).length;
}

const START_HAND_TIMEOUT_MS = 12000;
let startHandAckTimer = null;

function clearStartHandAckTimer() {
  if (startHandAckTimer) {
    clearTimeout(startHandAckTimer);
    startHandAckTimer = null;
  }
}

function resetStartHandPending(reason = '') {
  if (!startHandPending) return;
  startHandPending = false;
  clearStartHandAckTimer();
  if (reason) showRoomNotice(reason, 'error');
}

function showRoomNotice(text, type = '') {
  if (els.tableMessage) {
    els.tableMessage.textContent = text;
    els.tableMessage.className = `table-message${type ? ` table-message--${type}` : ''}`;
  }
  if (els.gameMessage) els.gameMessage.textContent = text;
}

const AVATAR_EMOJIS = ['😎', '🤠', '🦊', '🐼', '🐯', '🐸', '🐵', '👻', '🤖', '🦁', '🐨', '🐰'];

function avatarForPlayer(player) {
  const key = String(player?.id || player?.name || 'player');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length];
}

function setLobbyButtonsEnabled(enabled) {
  els.btnCreate.disabled = !enabled;
  els.btnJoin.disabled = !enabled;
}

function renderCards(container, cards) {
  container.innerHTML = '';
  (cards || []).forEach((label) => {
    const span = document.createElement('span');
    span.className = 'card-chip';
    if (label === '🂠') span.classList.add('card-chip--back');
    if (/[♥♦]/.test(label || '')) span.classList.add('card-chip--red');
    span.textContent = label || '🂠';
    container.appendChild(span);
  });
  if (!cards?.length) {
    const span = document.createElement('span');
    span.className = 'card-chip card-chip--empty';
    span.textContent = '—';
    container.appendChild(span);
  }
}

function cardHtml(label) {
  const classes = ['card-chip'];
  if (label === '🂠') classes.push('card-chip--back');
  if (/[♥♦]/.test(label || '')) classes.push('card-chip--red');
  return `<span class="${classes.join(' ')}">${label || '🂠'}</span>`;
}

function winnerCardsHtml(cards) {
  if (!cards?.length || cards.every((c) => c === '🂠')) return '';
  return `<div class="winner-cards">${cards.map(cardHtml).join('')}</div>`;
}

function buildTableEndSummary(hand) {
  const winners = hand?.winners || [];
  if (!winners.length) return '本局结束';

  const totalsById = new Map();
  winners.forEach((winner) => {
    const current = totalsById.get(winner.id) || {
      name: winner.name,
      amount: 0,
      handName: winner.handName,
    };
    current.amount += winner.amount;
    if (winner.handName) current.handName = winner.handName;
    totalsById.set(winner.id, current);
  });

  const entries = [...totalsById.values()];
  if (entries.length === 1) {
    const entry = entries[0];
    const handHint = entry.handName ? ` · ${entry.handName}` : '';
    return `${entry.name} 获胜 +${entry.amount}${handHint}`;
  }

  if (entries.length === 2) {
    return entries
      .map((entry) => {
        const handHint = entry.handName ? ` · ${entry.handName}` : '';
        return `${entry.name} +${entry.amount}${handHint}`;
      })
      .join(' · ');
  }

  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return `${entries.length} 位赢家 · 共 ${total}`;
}

function shortTableMessage(hand) {
  if (!hand) return '等待玩家入座';
  if (hand.phase === 'showdown') {
    const topHands = (hand.showdownHands || [])
      .slice(0, 3)
      .map((entry) => `${entry.name} ${entry.handName}`)
      .join(' · ');
    return topHands ? `亮牌 · ${topHands}` : '摊牌中…';
  }
  if (hand.phase === 'ended') {
    return buildTableEndSummary(hand);
  }
  const activeSeat = hand.seats?.find((seat) => seat.id === hand.activePlayerId);
  if (activeSeat) return `轮到 ${activeSeat.name}`;
  if (hand.phase && hand.phase !== 'waiting') {
    return PHASE_LABEL[hand.phase] || '—';
  }
  return hand.message || '—';
}

function formatWinnerDetail(winner) {
  const parts = [];
  if (winner.handName) parts.push(winner.handName);
  if (winner.reason) parts.push(winner.reason);
  if (winner.potAmount && winner.potAmount !== winner.amount) parts.push(`奖池 ${winner.potAmount}`);
  if (winner.split) parts.push('平分');
  return parts.join(' · ') || '获胜';
}

function buildWinnerRow(winner, seat, className, includeCards = false) {
  const li = document.createElement('li');
  li.className = className;
  li.innerHTML = `
    <strong>${winner.name}</strong>
    <span>+${winner.amount}</span>
    <small>${formatWinnerDetail(winner)}</small>
    ${includeCards ? winnerCardsHtml(seat?.holeCards) : ''}
  `;
  return li;
}

function isHandInProgress(hand) {
  return Boolean(hand && hand.phase !== 'waiting' && hand.phase !== 'ended' && hand.phase !== 'showdown');
}

function renderResultSummary(hand) {
  const winners = hand?.winners;
  els.resultSummaryList.innerHTML = '';
  if (!winners?.length || hand.phase !== 'ended') return '';

  const seatById = new Map((hand.seats || []).map((seat) => [seat.id, seat]));
  const kicker = winners.length > 1 ? `本局结果 · ${winners.length} 项结算` : '本局结果';
  const isShowdown = (hand.showdownHands?.length ?? 0) > 0;

  if (winners.length === 1) {
    els.resultSummaryList.appendChild(
      buildWinnerRow(winners[0], seatById.get(winners[0].id), 'winner-summary-item', !isShowdown),
    );
  } else {
    winners.forEach((winner) => {
      els.resultSummaryList.appendChild(buildWinnerRow(winner, seatById.get(winner.id), 'winner-detail-item'));
    });
  }

  if (isShowdown) {
    const revealEntries = (hand.showdownHands || []).filter((entry) => entry.id !== myPlayerId);
    if (revealEntries.length) {
      const header = document.createElement('li');
      header.className = 'winner-reveal-kicker';
      header.textContent = '亮牌';
      els.resultSummaryList.appendChild(header);

      revealEntries.forEach((entry) => {
        const seat = seatById.get(entry.id);
        const li = document.createElement('li');
        li.className = 'winner-reveal-item';
        li.innerHTML = `
          <strong>${entry.name}</strong>
          <span class="winner-reveal-hand">${entry.handName || '—'}</span>
          ${winnerCardsHtml(seat?.holeCards)}
        `;
        els.resultSummaryList.appendChild(li);
      });
    }
  }

  return kicker;
}

function renderResultPanel(hand) {
  const isShowdown = hand?.phase === 'showdown';
  const isEnded = hand?.phase === 'ended';

  if (isShowdown || !isEnded) {
    els.resultPanel.hidden = true;
    els.resultPanel.classList.remove('is-ended', 'is-showdown');
    els.resultPanelBody.hidden = true;
    els.btnToggleResult.classList.remove('is-open');
    return;
  }

  els.resultPanel.classList.remove('is-showdown');

  const hasLogs = hand.actionLogs?.length;
  const hasWinners = hand.winners?.length;
  const showPanel = Boolean(hasWinners || hasLogs);
  const resultSignature = handResultSignature(hand);
  const hasResultLogs = hand.actionLogs.some((log) => log.action === 'settle' || log.action === 'win');

  if (resultSignature && resultSignature !== lastHandResultSignature) {
    lastHandResultSignature = resultSignature;
    resultPanelDelayUntil = Date.now() + RESULT_PANEL_DELAY_MS;
    resultPanelOpen = false;
  }

  if (Date.now() < resultPanelDelayUntil) {
    els.resultPanel.hidden = true;
    els.resultPanelBody.hidden = true;
    els.btnToggleResult.classList.remove('is-open');
    scheduleResultPanelReveal();
    return;
  }

  els.resultPanel.hidden = !showPanel;
  if (!showPanel) {
    els.resultPanel.classList.remove('is-ended');
    resultPanelOpen = false;
    els.resultPanelBody.hidden = true;
    els.btnToggleResult.classList.remove('is-open');
    return;
  }

  if (hasResultLogs && !resultPanelOpen) {
    resultPanelOpen = true;
  }

  els.resultPanel.classList.add('is-ended');
  const summaryKicker = renderResultSummary(hand);
  els.resultSummaryList.hidden = !hasWinners;
  els.resultLogKicker.hidden = !hasWinners || !hasLogs;

  const logs = hand.actionLogs.slice().reverse();
  els.resultLatest.textContent = formatActionLog(logs[0]).replace(/^.*? · /, '');
  els.resultLogList.innerHTML = '';
  logs.forEach((log) => {
    const li = document.createElement('li');
    if (log.action === 'settle' || log.action === 'win') li.classList.add('is-settle');
    li.textContent = formatActionLog(log);
    els.resultLogList.appendChild(li);
  });

  els.resultKicker.textContent = summaryKicker || '本局结果';
  els.resultPanelBody.hidden = !resultPanelOpen;
  els.btnToggleResult.classList.toggle('is-open', resultPanelOpen);
}

function setDockVisible(visible) {
  els.bottomDock.hidden = !visible;
  document.body.classList.toggle('has-dock', visible);
  updateLayoutMetrics();
}

function syncDockVisibility() {
  setDockVisible(!els.btnStartHand.hidden || !els.actionBar.hidden || !els.allInConfirm.hidden);
}

function hideAllInConfirm() {
  els.allInConfirm.hidden = true;
  syncDockVisibility();
}

function showAllInConfirm() {
  const hand = getCurrentHand();
  const seat = hand?.seats?.find((s) => s.id === myPlayerId);
  els.allInConfirmText.textContent = `你将投入全部 ${seat?.chips ?? ''} 筹码`;
  els.allInConfirm.hidden = false;
  syncDockVisibility();
}

function scrollToMySeat() {
  const me = els.seatList.querySelector('.seat-item.is-me');
  if (me && !els.seatList.classList.contains('table-seats')) {
    me.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

let actionTimerInterval = null;

function clearActionTimer() {
  if (actionTimerInterval) {
    window.clearInterval(actionTimerInterval);
    actionTimerInterval = null;
  }
  els.actionTimer.hidden = true;
}

function renderShowdownTimer(hand) {
  clearActionTimer();
  if (hand?.phase !== 'showdown' || !hand.showdownDeadlineAt) return;

  const update = () => {
    const remainMs = Math.max(0, hand.showdownDeadlineAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    els.actionTimer.hidden = false;
    els.actionTimer.textContent = `摊牌中 · ${remainSec}s 后结算`;
    els.actionTimer.classList.toggle('is-warning', remainSec <= 1);
    if (remainMs <= 0) window.clearInterval(actionTimerInterval);
  };
  update();
  actionTimerInterval = window.setInterval(update, 250);
}

function refreshOfflineFoldCountdowns() {
  const gameState = window.__lastGameState;
  if (!gameState) return;
  renderPresenceBanner(gameState);
  document.querySelectorAll('.offline-fold-tag').forEach((tag) => {
    const deadline = Number(tag.dataset.deadline || 0);
    const remainSec = formatRemainSec(deadline);
    tag.textContent = remainSec > 0 ? `${remainSec}s 弃` : '弃牌中';
  });
}

function renderActionTimer(hand) {
  clearActionTimer();
  if (hand?.phase === 'showdown') {
    renderShowdownTimer(hand);
    return;
  }

  const activeSeat = hand?.seats?.find((s) => s.id === hand.activePlayerId);
  if (hand?.activePlayerId && !hand.actionDeadlineAt && activeSeat?.online === false) {
    els.actionTimer.hidden = false;
    els.actionTimer.textContent = `等待 ${activeSeat.name} 重新连接…`;
    els.actionTimer.classList.remove('is-warning');
    actionTimerInterval = window.setInterval(refreshOfflineFoldCountdowns, 250);
    return;
  }

  if (!hand?.actionDeadlineAt || !hand.activePlayerId) return;

  const update = () => {
    const remainMs = Math.max(0, hand.actionDeadlineAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    els.actionTimer.hidden = false;
    els.actionTimer.textContent = `轮到 ${activeSeat?.name || '玩家'} · 剩余 ${remainSec}s${hand.activePlayerId === myPlayerId ? ' · 到时自动操作' : ''}`;
    els.actionTimer.classList.toggle('is-warning', remainSec <= 5);
    refreshOfflineFoldCountdowns();
    if (remainMs <= 0) window.clearInterval(actionTimerInterval);
  };
  update();
  actionTimerInterval = window.setInterval(update, 250);
}

function formatSettlementLog(log) {
  if (log.action === 'settle') {
    return log.note || '结算';
  }
  if (log.action === 'win') {
    const name = log.playerName || '系统';
    const amount = log.amount || 0;
    if (log.note) return `主池 ${amount} · ${name} +${amount}(${log.note})`;
    return `${name} 获胜 ${amount}`;
  }
  return log.note || '结算';
}

function formatActionLog(log) {
  const phase = PHASE_LABEL[log.phase] || log.phase;
  if (log.action === 'settle' || log.action === 'win') {
    return `${phase} · ${formatSettlementLog(log)}`;
  }
  if (log.action === 'showdown') {
    return `${phase} · 开始摊牌`;
  }

  const name = log.playerName || '系统';
  const amount = log.amount ? ` ${log.amount}` : '';
  const label = {
    smallBlind: '小盲',
    bigBlind: '大盲',
    fold: '弃牌',
    check: '过牌',
    call: '跟注',
    bet: '下注',
    raise: '加注',
    allin: '全下',
    win: '获胜',
    dealFlop: '发 Flop',
    dealTurn: '发 Turn',
    dealRiver: '发 River',
  }[log.action] || log.action;
  return `${phase} · ${name} ${label}${amount}${log.note ? `（${log.note}）` : ''}`;
}

const TABLE_SEAT_SLOTS = [
  'seat-pos-3', // 0 · 顶中
  'seat-pos-2', // 1 · 左上
  'seat-pos-4', // 2 · 右上
  'seat-pos-6', // 3 · 左中
  'seat-pos-7', // 4 · 右中
  'seat-pos-1', // 5 · 左下
  'seat-pos-5', // 6 · 右下
  'seat-pos-8', // 7 · 底右（与 pos-0 对称）
  'seat-pos-0', // 8 · 底中（旋转后固定为「我」）
];

function tableSeatClass(index, count) {
  if (count <= 1) return 'seat-pos-0';
  if (count === 2) return ['seat-pos-3', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 3) return ['seat-pos-2', 'seat-pos-4', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 4) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 5) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-1', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 6) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-1', 'seat-pos-5', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 7) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-6', 'seat-pos-7', 'seat-pos-1', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 8) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-6', 'seat-pos-7', 'seat-pos-1', 'seat-pos-5', 'seat-pos-0'][index] || 'seat-pos-0';
  return TABLE_SEAT_SLOTS[index] || 'seat-pos-0';
}

function applyTableSeatLayout(seatCount) {
  if (!els.seatList) return;
  const count = Math.max(0, Number(seatCount) || 0);
  els.seatList.className = 'seat-list table-seats';
  if (count >= 7) els.seatList.classList.add('is-dense');
  if (count >= 9) els.seatList.classList.add('is-full-table');
  els.seatList.dataset.seatCount = count > 0 ? String(count) : '';
}

function orderSeatsForTable(seats) {
  const list = [...(seats || [])];
  const meIndex = list.findIndex((seat) => seat.id === myPlayerId);
  if (meIndex >= 0) {
    const [me] = list.splice(meIndex, 1);
    list.push(me);
  }
  return list;
}

function isRoomHost(gameState) {
  if (!gameState || !myPlayerId) return false;
  if (gameState.hostPlayerId === myPlayerId) return true;
  const me = gameState.players?.find((player) => player.id === myPlayerId);
  return Boolean(me?.isHost);
}

function settingsSnapshot(settings) {
  if (!settings) return '';
  return `${settings.startingChips}|${settings.smallBlind}|${settings.bigBlind}`;
}

function isSettingsEditable(gameState, hand) {
  if (typeof gameState?.canEditSettings === 'boolean') return gameState.canEditSettings;
  if (!hand) return true;
  return hand.phase === 'waiting' || hand.phase === 'ended' || hand.phase === 'showdown';
}

function readSettingsDraft() {
  return {
    startingChips: Number(els.settingStartingChips?.value),
    smallBlind: Number(els.settingSmallBlind?.value),
    bigBlind: Number(els.settingBigBlind?.value),
  };
}

function getSettingsInteractionMode(gameState, hand) {
  if (!isRoomHost(gameState)) return SETTINGS_MODE.READONLY;
  if (isSettingsEditable(gameState, hand)) return SETTINGS_MODE.EDIT;
  return SETTINGS_MODE.LOCKED;
}

function validateSettingsDraft(draft) {
  const startingChips = Math.floor(Number(draft.startingChips));
  const smallBlind = Math.floor(Number(draft.smallBlind));
  const bigBlind = Math.floor(Number(draft.bigBlind));

  if (!Number.isFinite(startingChips) || startingChips < SETTINGS_LIMITS.startingChips.min || startingChips > SETTINGS_LIMITS.startingChips.max) {
    return { ok: false, error: `起始筹码须为 ${SETTINGS_LIMITS.startingChips.min}–${SETTINGS_LIMITS.startingChips.max}` };
  }
  if (!Number.isFinite(smallBlind) || smallBlind < SETTINGS_LIMITS.smallBlind.min || smallBlind > SETTINGS_LIMITS.smallBlind.max) {
    return { ok: false, error: `小盲须为 ${SETTINGS_LIMITS.smallBlind.min}–${SETTINGS_LIMITS.smallBlind.max}` };
  }
  if (!Number.isFinite(bigBlind) || bigBlind < SETTINGS_LIMITS.bigBlind.min || bigBlind > SETTINGS_LIMITS.bigBlind.max) {
    return { ok: false, error: `大盲须为 ${SETTINGS_LIMITS.bigBlind.min}–${SETTINGS_LIMITS.bigBlind.max}` };
  }
  if (bigBlind < smallBlind) {
    return { ok: false, error: '大盲不能小于小盲' };
  }
  return { ok: true, draft: { startingChips, smallBlind, bigBlind } };
}

function isSettingsDraftDirty() {
  if (!lastSyncedSettingsSnap) return false;
  return settingsSnapshot(readSettingsDraft()) !== lastSyncedSettingsSnap;
}

function formatSettingsSummary(settings) {
  if (!settings) return '—';
  return `${settings.smallBlind} / ${settings.bigBlind} · 起始 ${settings.startingChips}`;
}

function getBlindsContextLabel(hand, settings) {
  if (!settings) return '盲注 —';
  const summary = `${settings.smallBlind}/${settings.bigBlind}`;
  if (!hand || hand.phase === 'waiting') return `下局 ${summary}`;
  if (hand.phase === 'ended' || hand.phase === 'showdown') return `下局 ${summary}`;
  return `本局 ${summary}`;
}

function syncSettingsFormValues(settings) {
  if (!settings) return;
  els.settingStartingChips.value = settings.startingChips;
  els.settingSmallBlind.value = settings.smallBlind;
  els.settingBigBlind.value = settings.bigBlind;
  lastSyncedSettingsSnap = settingsSnapshot(settings);
  roomSettingsEditing = false;
}

function revertSettingsDraft() {
  const gameState = window.__lastGameState;
  const hand = window.__lastHandState;
  const settings = gameState?.roomSettings;
  if (!settings) return;
  syncSettingsFormValues(settings);
  if (els.roomSettingsError) {
    els.roomSettingsError.hidden = true;
    els.roomSettingsError.textContent = '';
  }
  const mode = getSettingsInteractionMode(gameState, hand);
  renderRoomSettingsMeta(mode, false, hand);
  updateSettingsActionState(mode);
}

function renderSettingsDisplayValues(settings) {
  if (!settings) return;
  if (els.displayStartingChips) els.displayStartingChips.textContent = String(settings.startingChips);
  if (els.displaySmallBlind) els.displaySmallBlind.textContent = String(settings.smallBlind);
  if (els.displayBigBlind) els.displayBigBlind.textContent = String(settings.bigBlind);
}

function isSettingsMobileViewport() {
  return SETTINGS_MOBILE_MQL.matches;
}

function getSettingsHandPhase(hand) {
  return hand?.phase ?? 'lobby';
}

function resolveSettingsExpanded({ mode, hand, dirty, hasValidationError, isMobile, isFirstLobby }) {
  const phase = getSettingsHandPhase(hand);

  if (dirty || hasValidationError) return true;
  if (settingsExpandedManual) return false;
  if (mode === SETTINGS_MODE.LOCKED || mode === SETTINGS_MODE.READONLY) return false;

  if (isFirstLobby) return !settingsEverSaved;
  if (phase === 'ended' || phase === 'showdown') return false;
  if (isMobile) return false;
  return false;
}

function maybeScrollResultIntoView() {
  if (!els.resultPanel || els.resultPanel.hidden) return;
  window.requestAnimationFrame(() => {
    els.resultPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function maybeScrollSettingsIntoView() {
  if (!els.roomSettingsBox || els.roomSettingsBox.hidden) return;
  window.requestAnimationFrame(() => {
    els.roomSettingsBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function setSettingsPanelExpanded(expanded) {
  settingsPanelExpanded = expanded;
  if (els.roomSettingsBody) els.roomSettingsBody.hidden = !expanded;
  if (els.btnToggleSettings) els.btnToggleSettings.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  if (els.roomSettingsBox) {
    els.roomSettingsBox.classList.toggle('is-expanded', expanded);
    els.roomSettingsBox.classList.toggle('is-collapsed', !expanded);
  }
}

function applySettingsExpansion(gameState, hand, mode, dirty, hasValidationError) {
  const phase = getSettingsHandPhase(hand);
  const prevMode = lastSettingsMode;
  const prevPhase = lastSettingsHandPhase;
  const isFirstLobby = !hand;
  const isMobile = isSettingsMobileViewport();

  if (IN_HAND_PHASES.has(phase) && !IN_HAND_PHASES.has(prevPhase)) {
    settingsExpandedManual = false;
  }
  if (phase === 'ended' && prevPhase !== 'ended' && !dirty && !hasValidationError) {
    settingsExpandedManual = true;
  }

  let nextExpanded;
  if (dirty || hasValidationError) {
    settingsExpandedManual = false;
    nextExpanded = true;
  } else if (settingsExpandedManual) {
    nextExpanded = false;
  } else if (mode !== prevMode || phase !== prevPhase) {
    nextExpanded = resolveSettingsExpanded({
      mode,
      hand,
      dirty,
      hasValidationError,
      isMobile,
      isFirstLobby,
    });
  } else {
    nextExpanded = settingsPanelExpanded;
  }

  const wasCollapsed = !settingsPanelExpanded;
  setSettingsPanelExpanded(nextExpanded);

  if (nextExpanded && wasCollapsed && (dirty || hasValidationError || (isFirstLobby && !settingsEverSaved))) {
    maybeScrollSettingsIntoView();
  }

  if (phase === 'ended' && prevPhase !== 'ended') {
    maybeScrollResultIntoView();
  }

  lastSettingsMode = mode;
  lastSettingsHandPhase = phase;
}

function updateSettingsActionState(mode) {
  const dirty = isSettingsDraftDirty();
  const validation = validateSettingsDraft(readSettingsDraft());
  const canSave = mode === SETTINGS_MODE.EDIT && dirty && validation.ok && !settingsSavePending;

  if (els.roomSettingsError) {
    if (mode === SETTINGS_MODE.EDIT && dirty && !validation.ok) {
      els.roomSettingsError.hidden = false;
      els.roomSettingsError.textContent = validation.error;
    } else {
      els.roomSettingsError.hidden = true;
      els.roomSettingsError.textContent = '';
    }
  }

  if (els.btnSaveSettings) {
    els.btnSaveSettings.disabled = !canSave;
    els.btnSaveSettings.textContent = settingsSavePending ? '保存中…' : dirty ? '保存设置' : '已是最新';
  }
  if (els.btnCancelSettings) els.btnCancelSettings.disabled = mode !== SETTINGS_MODE.EDIT || !dirty || settingsSavePending;
  if (els.btnPresetBlinds1020) els.btnPresetBlinds1020.disabled = mode !== SETTINGS_MODE.EDIT || settingsSavePending;
  if (els.btnPresetBlinds2550) els.btnPresetBlinds2550.disabled = mode !== SETTINGS_MODE.EDIT || settingsSavePending;
}

function renderRoomSettingsMeta(mode, dirty, hand) {
  const meta = {
    [SETTINGS_MODE.EDIT]: {
      status: dirty ? '未保存' : '可编辑',
      tone: dirty ? 'warn' : 'ok',
      help: dirty
        ? '你有未保存的修改，保存后下一局开始时生效。'
        : hand?.phase === 'ended'
          ? '本局已结束，请先查看下方对战结果；需要改盲注时再展开。'
          : '修改后点「保存设置」，下一局开始时生效。',
    },
    [SETTINGS_MODE.LOCKED]: {
      status: '局内锁定',
      tone: 'lock',
      help: '本局进行中暂不可改。局结束或摊牌后可再次编辑，修改对下一局生效。',
    },
    [SETTINGS_MODE.READONLY]: {
      status: '只读',
      tone: 'neutral',
      help: '当前盲注由房主设置，仅房主可在局间修改。',
    },
  }[mode];

  if (els.roomSettingsStatus) {
    els.roomSettingsStatus.textContent = meta.status;
    els.roomSettingsStatus.dataset.tone = meta.tone;
  }
  if (els.roomSettingsHelp) els.roomSettingsHelp.textContent = meta.help;
}

function formatRemainSec(deadlineAt) {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}

function resumeErrorMessage(res) {
  if (res?.code === 'ROOM_NOT_FOUND') return '房间已解散，请重新加入';
  if (res?.code === 'SESSION_INVALID') return '会话已失效，请重新加入房间';
  if (res?.code === 'PLAYER_NOT_FOUND') return '玩家不在房间中，请重新加入';
  return res?.error || '恢复失败，请重新加入房间';
}

function buildPlayerMetaMap(players) {
  return new Map((players || []).map((player) => [player.id, player]));
}

function renderPresenceBanner(gameState) {
  if (!els.presenceBanner) return;

  const viewer = gameState?.viewer;
  let text = '';
  let tone = 'neutral';
  let visible = false;

  if (sessionResuming) {
    text = '正在恢复会话…';
    tone = 'warn';
    visible = true;
  } else if (!socketConnected) {
    text = '连接已断开，正在自动重连…';
    tone = 'warn';
    visible = true;
  } else if (resumeNoticeUntil > Date.now()) {
    text = viewer?.inHand ? '已重新连接，欢迎回来' : '已重新连接';
    tone = 'ok';
    visible = true;
  } else if (viewer?.isSpectating) {
    text = '本局旁观中，下一局开始时自动入局';
    tone = 'info';
    visible = true;
  }

  els.presenceBanner.hidden = !visible;
  els.presenceBanner.dataset.tone = tone;
  els.presenceBanner.textContent = text;
}

function renderWaitingPlayers(gameState, hand) {
  if (!els.waitingPlayersBox || !els.waitingPlayersList) return;
  const waiting = gameState?.waitingPlayers || [];
  const show = Boolean(hand && waiting.length > 0);
  els.waitingPlayersBox.hidden = !show;
  els.waitingPlayersList.innerHTML = '';
  if (!show) return;

  waiting.forEach((player) => {
    const li = document.createElement('li');
    li.className = 'waiting-player-chip';
    if (player.id === myPlayerId) li.classList.add('is-me');
    if (!player.online) li.classList.add('is-offline');
    li.innerHTML = `
      <span class="waiting-player-name">${player.name}</span>
      <span class="waiting-player-meta">${player.online ? '下局入局' : '离线 · 下局在线后入局'}</span>
    `;
    els.waitingPlayersList.appendChild(li);
  });
}

function renderRoomSettings(gameState, hand) {
  const settings = gameState?.roomSettings;
  const effectiveBlinds = hand?.smallBlind != null && hand?.bigBlind != null
    ? { ...settings, smallBlind: hand.smallBlind, bigBlind: hand.bigBlind }
    : settings;

  if (els.roomBlindsLabel) {
    els.roomBlindsLabel.textContent = getBlindsContextLabel(hand, effectiveBlinds);
  }
  if (!els.roomSettingsBox) return;

  els.roomSettingsBox.hidden = false;

  const mode = getSettingsInteractionMode(gameState, hand);
  els.roomSettingsBox.dataset.mode = mode;

  if (els.roomSettingsSummary && settings) {
    els.roomSettingsSummary.textContent = formatSettingsSummary(settings);
  }

  renderSettingsDisplayValues(settings);

  const serverSnap = settingsSnapshot(settings);
  const shouldSyncValues = Boolean(
    settings
    && mode === SETTINGS_MODE.EDIT
    && !roomSettingsEditing
    && !settingsSavePending
    && !isSettingsDraftDirty()
    && serverSnap !== lastSyncedSettingsSnap,
  );
  if (shouldSyncValues) syncSettingsFormValues(settings);
  if (mode === SETTINGS_MODE.EDIT && !lastSyncedSettingsSnap && settings) {
    syncSettingsFormValues(settings);
  }

  const dirty = isSettingsDraftDirty();
  const validation = validateSettingsDraft(readSettingsDraft());
  const hasValidationError = mode === SETTINGS_MODE.EDIT && dirty && !validation.ok;

  applySettingsExpansion(gameState, hand, mode, dirty, hasValidationError);

  const showForm = mode === SETTINGS_MODE.EDIT;
  if (els.roomSettingsForm) els.roomSettingsForm.hidden = !showForm;
  if (els.roomSettingsDisplay) els.roomSettingsDisplay.hidden = showForm;

  renderRoomSettingsMeta(mode, dirty, hand);
  updateSettingsActionState(mode);
}

/** 仅渲染服务端 gameState */
function renderHandHistory(entries) {
  const list = entries || [];
  if (!els.handHistoryBox || !els.handHistoryList) return;
  els.handHistoryBox.hidden = list.length === 0;
  els.handHistoryList.innerHTML = '';
  list.forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = entry.summary || '—';
    if (entry.wasShowdown) li.dataset.showdown = 'true';
    els.handHistoryList.appendChild(li);
  });
}

function formatNetChips(value) {
  const amount = Number(value) || 0;
  if (amount > 0) return `+${amount}`;
  return String(amount);
}

function renderChipStats(entries) {
  const list = entries || [];
  if (!els.chipStatsBox || !els.chipStatsList) return;
  const hasActivity = list.some((entry) => (entry.handsPlayed ?? 0) > 0);
  els.chipStatsBox.hidden = !hasActivity;
  els.chipStatsList.innerHTML = '';
  list.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'chip-stats-item';
    if (entry.id === myPlayerId) li.classList.add('is-me');
    const netClass = entry.netChips > 0 ? 'is-up' : entry.netChips < 0 ? 'is-down' : '';
    li.innerHTML = `
      <span class="chip-stats-name">${entry.name}</span>
      <span class="chip-stats-net ${netClass}">${formatNetChips(entry.netChips)}</span>
      <span class="chip-stats-record">${entry.handsWon}/${entry.handsPlayed}</span>
      <span class="chip-stats-chips">${entry.chips ?? '—'}</span>
    `;
    els.chipStatsList.appendChild(li);
  });
}

function renderGameState(gameState) {
  if (!gameState) return;
  window.__lastGameState = gameState;

  setScreen('room');
  setDockVisible(true);
  els.currentRoomId.textContent = gameState.roomId;
  els.roomId.value = gameState.roomId;

  const { players, hand } = gameState;
  window.__lastHandState = hand;

  if ((gameState.handHistory?.length ?? 0) > 0) {
    settingsEverSaved = true;
  }

  if (hand && hand.phase !== 'waiting' && hand.phase !== 'ended' && startHandPending) {
    resetStartHandPending();
  }

  els.roomPlayerSummary.textContent = `玩家 ${players.length}/9`;
  renderHandHistory(gameState.handHistory);
  renderChipStats(gameState.chipStats);
  renderRoomSettings(gameState, hand);

  if (!hand) {
    els.gamePhase.textContent = '大厅';
    els.tablePotLabel.textContent = '底池';
    els.gamePot.textContent = '0';
    els.gameMessage.textContent = '至少 2 人可开始新一局';
    els.tableMessage.textContent = shortTableMessage(null);
    renderCards(els.communityCards, []);
    const me = players.find((p) => p.id === myPlayerId);
    els.mySeatPanel.hidden = !me;
    els.mySeatName.textContent = me?.name || '我';
    els.mySeatMeta.textContent = me ? (me.online ? '等待开局' : '离线保留中') : '等待入局';
    renderCards(els.myCards, []);
    els.seatList.innerHTML = '';
    const tablePlayers = orderSeatsForTable(players);
    applyTableSeatLayout(tablePlayers.length);
    tablePlayers.forEach((p, index) => {
      const li = document.createElement('li');
      li.className = `seat-item seat-item--lobby ${tableSeatClass(index, tablePlayers.length)}`;
      if (p.id === myPlayerId) li.classList.add('is-me');
      li.innerHTML = `
        <div class="seat-avatar" aria-hidden="true">${avatarForPlayer(p)}</div>
        <div class="seat-name">${p.name}</div>
        <div class="seat-status-row">${p.isHost ? '<span class="tag tag-host">房主</span>' : ''}${p.online ? '' : '<span class="tag tag-fold">离线</span>'}</div>
        <div class="seat-meta">${p.online ? '等待开局' : '断线保留中'}</div>
      `;
      els.seatList.appendChild(li);
    });
    scrollToMySeat();
    els.resultPanel.hidden = true;
    els.resultPanel.classList.remove('is-ended');
    resetResultPanelTiming();
    lastRenderedHandPhase = null;
    clearActionTimer();
    const eligibleCount = countStartEligiblePlayers(players);
    const isHost = isRoomHost(gameState);
    els.btnStartHand.hidden = false;
    els.btnStartHand.disabled = startHandPending || eligibleCount < 2 || !isHost;
    els.btnStartHand.textContent = startHandPending
      ? '正在开始…'
      : isHost
        ? '开始新一局'
        : '等待房主开始';
    els.actionBar.hidden = true;
    els.actionHint.hidden = false;
    els.actionHint.textContent = !isHost
      ? '等待房主开始新一局'
      : eligibleCount < 2
        ? '至少 2 人在线且有筹码才能开始'
        : '房间已就绪，可以开始';
    els.allInConfirm.hidden = true;
    renderWaitingPlayers(gameState, null);
    renderPresenceBanner(gameState);
    syncDockVisibility();
    return;
  }
  els.gamePhase.textContent = PHASE_LABEL[hand.phase] || hand.phase;
  els.gamePhase.classList.toggle('is-showdown', hand.phase === 'showdown');
  const isEnded = hand.phase === 'ended';
  const isShowdown = hand.phase === 'showdown';
  els.tablePotLabel.textContent = isEnded ? '本局结束' : '底池';
  els.gamePot.textContent = isEnded ? '' : String(hand.pot);
  els.gameMessage.textContent = shortTableMessage(hand);
  els.tableMessage.textContent = shortTableMessage(hand);
  els.tableMessage.className = `table-message${isEnded ? ' is-ended' : ''}`;
  renderActionTimer(hand);
  renderCards(els.communityCards, hand.communityCards);

  const mySeat = hand.seats.find((seat) => seat.id === myPlayerId);
  const viewer = gameState.viewer;
  els.mySeatPanel.hidden = !mySeat && !viewer?.isSpectating;
  els.mySeatName.textContent = mySeat?.name || players.find((p) => p.id === myPlayerId)?.name || '我';
  els.mySeatMeta.textContent = mySeat
    ? `筹码 ${mySeat.chips} · 本轮 ${mySeat.bet}${mySeat.folded ? ' · 已弃牌' : ''}${mySeat.allIn ? ' · 全下' : ''}`
    : viewer?.isSpectating
      ? '本局旁观 · 下局自动入局'
      : '等待入局';
  renderCards(els.myCards, mySeat?.holeCards || []);

  els.seatList.innerHTML = '';
  const playerMeta = buildPlayerMetaMap(gameState.players);
  const tableSeats = orderSeatsForTable(hand.seats);
  applyTableSeatLayout(tableSeats.length);
  const winnerIds = new Set((hand.winners || []).map((w) => w.id));
  const showdownIds = new Set((hand.showdownHands || []).map((entry) => entry.id));
  tableSeats.forEach((seat, index) => {
    const li = document.createElement('li');
    li.className = `seat-item ${tableSeatClass(index, tableSeats.length)}`;
    if (seat.id === myPlayerId) li.classList.add('is-me');
    if (seat.id === hand.activePlayerId) li.classList.add('is-active');
    if (seat.folded) li.classList.add('is-folded');
    if (seat.allIn) li.classList.add('is-allin');
    if (seat.online === false) li.classList.add('is-offline');
    if (winnerIds.has(seat.id)) li.classList.add('is-winner');
    if (isShowdown && showdownIds.has(seat.id) && !seat.folded) li.classList.add('is-revealed');

    const meta = playerMeta.get(seat.id);
    const offlineDeadline = meta?.offlineFoldDeadlineAt;
    const offlineFoldTag = offlineDeadline && seat.online === false
      ? `<span class="tag tag-fold offline-fold-tag" data-deadline="${offlineDeadline}">${formatRemainSec(offlineDeadline)}s 弃</span>`
      : '';

    li.innerHTML = `
      <div class="seat-avatar" aria-hidden="true">${avatarForPlayer(seat)}</div>
      <div class="seat-name">${seat.name}</div>
      <div class="seat-meta">${seat.chips}</div>
      <div class="seat-status-row">
        ${seat.folded ? '<span class="tag tag-fold">弃</span>' : ''}
        ${seat.allIn ? '<span class="tag">全下</span>' : ''}
        ${seat.online === false ? '<span class="tag tag-fold">离线</span>' : ''}
        ${offlineFoldTag}
      </div>
      ${seat.bet > 0 ? `<div class="bet-stack">${seat.bet}</div>` : ''}
    `;
    els.seatList.appendChild(li);
  });
  scrollToMySeat();

  if (lastRenderedHandPhase === 'ended' && isHandInProgress(hand)) {
    resetResultPanelTiming();
  }
  lastRenderedHandPhase = hand.phase;

  renderResultPanel(hand);

  const inHand = isHandInProgress(hand);
  const eligibleCount = countStartEligiblePlayers(players);
  const canStartNew = hand.canStart && eligibleCount >= 2 && !inHand;
  const isHost = isRoomHost(gameState);
  els.btnStartHand.hidden = !canStartNew;
  els.btnStartHand.disabled = startHandPending || !canStartNew || !isHost;
  els.btnStartHand.textContent = startHandPending
    ? '正在开始…'
    : isHost
      ? '开始新一局'
      : '等待房主开始';

  const actions = hand.availableActions || {};
  const myTurn = Boolean(actions.isActive);
  if (!myTurn || !inHand) els.allInConfirm.hidden = true;
  const hasAmountAction = Boolean(actions.canBet || actions.canRaise);
  els.actionBar.hidden = !inHand;
  els.actionBar.classList.toggle('is-waiting', inHand && !myTurn);
  const showActionButtons = myTurn && inHand;

  const showBetControls = showActionButtons && hasAmountAction && betPanelOpen;
  document.body.classList.toggle('bet-panel-open', showBetControls);
  els.betAmount.closest('.bet-controls').hidden = !showBetControls;
  updateLayoutMetrics();
  els.btnAmountToggle.hidden = !showActionButtons || !hasAmountAction;
  els.btnAmountToggle.disabled = !hasAmountAction;
  els.btnAmountToggle.classList.toggle('is-active', showBetControls);
  els.betAmount.disabled = !showActionButtons;
  els.betAmount.min = String(actions.canBet ? actions.minBet : actions.minRaise);
  els.betAmount.placeholder = actions.canBet ? `最小下注 ${actions.minBet}` : `最小加注 ${actions.minRaise}`;
  if (showActionButtons && hasAmountAction && !els.betAmount.value) {
    setBetAmount(actions.canBet ? actions.minBet : actions.minRaise);
  }

  els.btnFold.hidden = !showActionButtons || !actions.canFold;
  els.btnCheck.hidden = !showActionButtons || !actions.canCheck;
  els.btnBet.hidden = !showActionButtons || !actions.canBet;
  els.btnCall.hidden = !showActionButtons || !actions.canCall;
  els.btnRaise.hidden = !showActionButtons || !actions.canRaise;
  els.btnAllIn.hidden = !showActionButtons || !actions.canAllIn;

  els.btnFold.disabled = !actions.canFold;
  els.btnCheck.disabled = !actions.canCheck;
  els.btnBet.disabled = !actions.canBet;
  els.btnCall.disabled = !actions.canCall;
  els.btnRaise.disabled = !actions.canRaise;
  els.btnAllIn.disabled = !actions.canAllIn;
  els.btnHalfPot.disabled = !showActionButtons;
  els.btnPot.disabled = !showActionButtons;
  els.btnDouble.disabled = !showActionButtons;
  els.btnTriple.disabled = !showActionButtons;

  els.btnCall.textContent = actions.toCall > 0 ? `跟注 ${actions.toCall}` : '跟注';
  els.btnCheck.textContent = '过牌';
  els.btnAllIn.textContent = '全下';
  els.btnAmountToggle.textContent = showBetControls ? '收起金额' : '调整金额';
  els.btnBet.textContent = `下注 ${getBetAmount() || actions.minBet}`;
  els.btnRaise.textContent = `加注 ${getBetAmount() || actions.minRaise}`;

  if (showActionButtons) {
    els.actionHint.textContent = actions.canRaise
      ? `跟注额 ${actions.toCall || 0} · 最小加注 ${actions.minRaise} · 可用 ${actions.maxAmount}`
      : actions.canBet
        ? `最小下注 ${actions.minBet} · 可用 ${actions.maxAmount}`
        : actions.toCall > 0
          ? `需要跟注 ${actions.toCall} · 可用 ${actions.maxAmount}`
          : '可以过牌或选择全下';
  } else if (inHand) {
    const activeSeat = hand.seats?.find((seat) => seat.id === hand.activePlayerId);
    els.actionHint.textContent = activeSeat
      ? `等待 ${activeSeat.name} 行动`
      : '等待其他玩家';
  } else if (canStartNew) {
    els.actionHint.textContent = !isHost
      ? '等待房主开始新一局'
      : eligibleCount < 2
        ? '至少 2 人在线且有筹码才能开始'
        : '本局已结束，可开始新一局';
  }
  els.actionHint.hidden = !(inHand || canStartNew);
  renderWaitingPlayers(gameState, hand);
  renderPresenceBanner(gameState);
  syncDockVisibility();
}

function clearRoomView() {
  betPanelOpen = false;
  resetResultPanelTiming();
  lastRenderedHandPhase = null;
  lastSettingsMode = null;
  lastSettingsHandPhase = null;
  settingsPanelExpanded = false;
  settingsExpandedManual = false;
  settingsEverSaved = false;
  lastSyncedSettingsSnap = '';
  roomSettingsEditing = false;
  if (els.roomSettingsBox) els.roomSettingsBox.hidden = true;
  document.body.classList.remove('bet-panel-open');
  setEntryMode();
  setDockVisible(false);
  els.seatList.innerHTML = '';
  els.mySeatPanel.hidden = true;
  els.allInConfirm.hidden = true;
  clearActionTimer();
}

socket.on('connect', () => {
  socketConnected = true;
  setStatus('已连接', 'online');
  setLobbyButtonsEnabled(true);

  if (currentSession?.roomId && currentSession?.playerId && currentSession?.token) {
    sessionResuming = true;
    if (window.__lastGameState) renderPresenceBanner(window.__lastGameState);
    setMessage('正在恢复房间状态…');
    socket.emit('room:resume', currentSession, (res) => {
      sessionResuming = false;
      if (!res?.ok) {
        saveSession(null);
        clearRoomView();
        setMessage(resumeErrorMessage(res), 'error');
        return;
      }
      rememberSession(res);
      resumeNoticeUntil = Date.now() + 4000;
      renderGameState(res.gameState);
      setMessage(`已恢复房间 ${res.gameState.roomId}`, 'success');
    });
    return;
  }

  setEntryMode();
  setMessage('Socket 连接成功', 'success');
});

socket.on('disconnect', () => {
  socketConnected = false;
  resetStartHandPending();
  setStatus('已断开', 'offline');
  setMessage('连接已断开，正在等待自动重连…');
  setLobbyButtonsEnabled(false);
  if (window.__lastGameState) renderPresenceBanner(window.__lastGameState);
});

socket.on('connect_error', (err) => {
  setStatus('连接失败', 'error');
  setMessage(`无法连接服务器: ${err.message}`, 'error');
  setLobbyButtonsEnabled(false);
});

socket.on('gameState', renderGameState);

function getPlayerName() {
  const name = els.playerName.value.trim();
  if (name) savePlayerName(name);
  return name || currentPlayerName.trim();
}

els.btnCreate.addEventListener('click', () => {
  if (!socket.connected) {
    setMessage('请先等待连接成功', 'error');
    return;
  }
  const playerName = getPlayerName();
  if (!playerName || playerName === '匿名玩家') {
    setMessage('请先输入昵称', 'error');
    return;
  }
  setMessage('正在创建房间…');
  socket.emit('room:create', { playerName }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || '创建失败', 'error');
      return;
    }
    rememberSession(res);
    renderGameState(res.gameState);
    setMessage(`房间 ${res.gameState.roomId} 创建成功`, 'success');
  });
});

els.btnJoin.addEventListener('click', () => {
  if (!socket.connected) {
    setMessage('请先等待连接成功', 'error');
    return;
  }
  const roomId = els.roomId.value.trim().toUpperCase();
  if (!roomId) {
    setMessage('请输入房间号', 'error');
    return;
  }
  const playerName = getPlayerName();
  if (!playerName || playerName === '匿名玩家') {
    setMessage('请先输入昵称', 'error');
    return;
  }
  setMessage(`正在加入房间 ${roomId}…`);
  socket.emit('room:join', { roomId, playerName }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || '加入失败', 'error');
      return;
    }
    rememberSession(res);
    renderGameState(res.gameState);
    setMessage(`已加入房间 ${res.gameState.roomId}`, 'success');
  });
});

function saveRoomSettings() {
  if (settingsSavePending || !socket.connected) return;
  const validation = validateSettingsDraft(readSettingsDraft());
  if (!validation.ok) {
    if (els.roomSettingsError) {
      els.roomSettingsError.hidden = false;
      els.roomSettingsError.textContent = validation.error;
    }
    updateSettingsActionState(SETTINGS_MODE.EDIT);
    return;
  }

  settingsSavePending = true;
  updateSettingsActionState(SETTINGS_MODE.EDIT);
  socket.emit('room:settings', validation.draft, (res) => {
    settingsSavePending = false;
    if (!res?.ok) {
      showRoomNotice(res?.error || '保存失败', 'error');
      updateSettingsActionState(SETTINGS_MODE.EDIT);
      return;
    }
    roomSettingsEditing = false;
    settingsEverSaved = true;
    settingsExpandedManual = false;
    lastSyncedSettingsSnap = settingsSnapshot(res.settings || res.gameState?.roomSettings);
    renderGameState(res.gameState);
    showRoomNotice('盲注设置已保存，下一局生效', 'success');
  });
}

function applyBlindPreset(smallBlind, bigBlind) {
  if (getSettingsInteractionMode(window.__lastGameState, window.__lastHandState) !== SETTINGS_MODE.EDIT) return;
  els.settingSmallBlind.value = String(smallBlind);
  els.settingBigBlind.value = String(bigBlind);
  roomSettingsEditing = true;
  updateSettingsActionState(SETTINGS_MODE.EDIT);
}

function bindRoomSettingsInputs() {
  [els.settingStartingChips, els.settingSmallBlind, els.settingBigBlind].forEach((input) => {
    if (!input) return;
    input.addEventListener('focus', () => {
      roomSettingsEditing = true;
    });
    input.addEventListener('input', () => {
      roomSettingsEditing = true;
      updateSettingsActionState(SETTINGS_MODE.EDIT);
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        const settingsInputs = [els.settingStartingChips, els.settingSmallBlind, els.settingBigBlind];
        if (!settingsInputs.includes(active)) roomSettingsEditing = false;
      }, 0);
    });
  });
}

bindRoomSettingsInputs();

els.btnToggleSettings?.addEventListener('click', () => {
  const next = !settingsPanelExpanded;
  setSettingsPanelExpanded(next);
  settingsExpandedManual = !next;
});

els.btnSaveSettings?.addEventListener('click', saveRoomSettings);
els.btnCancelSettings?.addEventListener('click', revertSettingsDraft);
els.btnPresetBlinds1020?.addEventListener('click', () => applyBlindPreset(10, 20));
els.btnPresetBlinds2550?.addEventListener('click', () => applyBlindPreset(25, 50));

els.btnStartHand.addEventListener('click', () => {
  if (startHandPending) return;
  if (els.btnStartHand.disabled) {
    if (!socket.connected) {
      showRoomNotice('连接已断开，请等待重连', 'error');
      return;
    }
    const gameState = window.__lastGameState;
    const isHost = isRoomHost(gameState);
    if (!isHost) {
      showRoomNotice('只有房主可以开始新一局', 'error');
      return;
    }
    if (countStartEligiblePlayers(gameState?.players) < 2) {
      showRoomNotice('至少 2 人在线且有筹码才能开始', 'error');
      return;
    }
    return;
  }
  if (!socket.connected) {
    showRoomNotice('连接已断开，请等待重连', 'error');
    return;
  }

  startHandPending = true;
  els.btnStartHand.disabled = true;
  els.btnStartHand.textContent = '正在开始…';
  clearStartHandAckTimer();
  startHandAckTimer = setTimeout(() => {
    if (!startHandPending) return;
    resetStartHandPending('开始请求超时，请重试');
    if (window.__lastGameState) renderGameState(window.__lastGameState);
  }, START_HAND_TIMEOUT_MS);

  socket.emit('game:start', {}, (res) => {
    clearStartHandAckTimer();
    startHandPending = false;
    if (!res?.ok) {
      showRoomNotice(res?.error || '无法开始', 'error');
      if (window.__lastGameState) renderGameState(window.__lastGameState);
      return;
    }
    renderGameState(res.gameState);
    showRoomNotice('新一局已开始', 'success');
  });
});

function getBetAmount() {
  const value = Number(els.betAmount.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function setBetAmount(amount) {
  els.betAmount.value = String(Math.max(1, Math.floor(amount)));
}

function getCurrentHand() {
  return window.__lastHandState || null;
}

function quickBet(multiplier) {
  const hand = getCurrentHand();
  const actions = hand?.availableActions;
  if (!hand || !actions?.isActive) return;
  const base = multiplier === 'halfPot'
    ? Math.ceil(hand.pot / 2)
    : multiplier === 'pot'
      ? hand.pot
      : hand.bigBlind * multiplier;
  const minimum = actions.canBet ? actions.minBet : actions.minRaise;
  setBetAmount(Math.min(actions.maxAmount, Math.max(minimum, base)));
}

function emitAction(action, amount) {
  socket.emit('game:action', { action, amount }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || '操作失败', 'error');
      return;
    }
    betPanelOpen = false;
    els.allInConfirm.hidden = true;
    document.body.classList.remove('bet-panel-open');
    renderGameState(res.gameState);
  });
}

els.btnFold.addEventListener('click', () => emitAction('fold'));
els.btnCheck.addEventListener('click', () => emitAction('check'));
els.btnBet.addEventListener('click', () => {
  const amount = getBetAmount();
  if (!amount) {
    setMessage('请输入下注金额', 'error');
    return;
  }
  emitAction('bet', amount);
});
els.btnCall.addEventListener('click', () => emitAction('call'));
els.btnRaise.addEventListener('click', () => {
  const amount = getBetAmount();
  if (!amount) {
    setMessage('请输入加注金额', 'error');
    return;
  }
  emitAction('raise', amount);
});
els.btnAllIn.addEventListener('click', showAllInConfirm);
els.btnCancelAllIn.addEventListener('click', hideAllInConfirm);
els.btnConfirmAllIn.addEventListener('click', () => emitAction('allin'));
els.btnToggleResult.addEventListener('click', () => {
  resultPanelOpen = !resultPanelOpen;
  els.resultPanelBody.hidden = !resultPanelOpen;
  els.btnToggleResult.classList.toggle('is-open', resultPanelOpen);
});
els.betAmount.addEventListener('input', () => {
  const hand = getCurrentHand();
  const actions = hand?.availableActions || {};
  if (actions.canBet) els.btnBet.textContent = `下注 ${getBetAmount() || actions.minBet}`;
  if (actions.canRaise) els.btnRaise.textContent = `加注 ${getBetAmount() || actions.minRaise}`;
});
els.btnAmountToggle.addEventListener('click', () => {
  betPanelOpen = !betPanelOpen;
  const hand = getCurrentHand();
  const actions = hand?.availableActions;
  const showBetControls = Boolean(actions?.isActive && (actions.canBet || actions.canRaise) && betPanelOpen);
  document.body.classList.toggle('bet-panel-open', showBetControls);
  els.betAmount.closest('.bet-controls').hidden = !showBetControls;
  updateLayoutMetrics();
  syncDockVisibility();
  els.btnAmountToggle.classList.toggle('is-active', showBetControls);
});
els.btnHalfPot.addEventListener('click', () => quickBet('halfPot'));
els.btnPot.addEventListener('click', () => quickBet('pot'));
els.btnDouble.addEventListener('click', () => quickBet(2));
els.btnTriple.addEventListener('click', () => quickBet(3));

if ('ResizeObserver' in window) {
  dockResizeObserver = new ResizeObserver(updateLayoutMetrics);
  dockResizeObserver.observe(els.bottomDock);
}
window.addEventListener('resize', updateLayoutMetrics);
window.addEventListener('orientationchange', () => window.setTimeout(updateLayoutMetrics, 150));
updateLayoutMetrics();
els.btnLeaveRoom.addEventListener('click', () => {
  socket.emit('room:leave', {}, (res) => {
    if (!res?.ok) {
      if (res?.error === '未在房间中' || res?.error === '房间不存在') {
        saveSession(null);
        clearRoomView();
        setMessage('已清理本地房间状态，请重新加入', 'success');
        return;
      }
      setMessage(res?.error || '退出失败', 'error');
      return;
    }
    saveSession(null);
    clearRoomView();
    setMessage('已退出房间', 'success');
  });
});

setEntryMode(currentPlayerName ? 'entry' : 'login');
setLobbyButtonsEnabled(false);
setStatus('连接中…', 'offline');
