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
let resultPanelRevealTimer = null;
let resultPanelDelayUntil = 0;

const RESULT_PANEL_DELAY_MS = 600;

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
    if (hand?.phase === 'ended') renderResultPanel(hand);
  }, delay);
}

function resetResultPanelTiming() {
  clearResultPanelRevealTimer();
  resultPanelDelayUntil = 0;
  resultPanelOpen = false;
  lastHandResultSignature = '';
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

function renderActionTimer(hand) {
  clearActionTimer();
  if (hand?.phase === 'showdown') {
    renderShowdownTimer(hand);
    return;
  }
  if (!hand?.actionDeadlineAt || !hand.activePlayerId) return;

  const activeSeat = hand.seats.find((s) => s.id === hand.activePlayerId);
  const update = () => {
    const remainMs = Math.max(0, hand.actionDeadlineAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    els.actionTimer.hidden = false;
    els.actionTimer.textContent = `轮到 ${activeSeat?.name || '玩家'} · 剩余 ${remainSec}s${hand.activePlayerId === myPlayerId ? ' · 到时自动操作' : ''}`;
    els.actionTimer.classList.toggle('is-warning', remainSec <= 5);
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

function tableSeatClass(index, count) {
  if (count <= 1) return 'seat-pos-0';
  if (count === 2) return ['seat-pos-3', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 3) return ['seat-pos-2', 'seat-pos-4', 'seat-pos-0'][index] || 'seat-pos-0';
  if (count === 4) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-0'][index] || 'seat-pos-0';
  return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-1', 'seat-pos-5', 'seat-pos-6', 'seat-pos-7', 'seat-pos-8', 'seat-pos-0'][index] || 'seat-pos-0';
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

function renderGameState(gameState) {
  if (!gameState) return;
  window.__lastGameState = gameState;

  setScreen('room');
  setDockVisible(true);
  els.currentRoomId.textContent = gameState.roomId;
  els.roomId.value = gameState.roomId;

  const { players, hand } = gameState;
  window.__lastHandState = hand;

  els.roomPlayerSummary.textContent = `玩家 ${players.length}/9`;
  renderHandHistory(gameState.handHistory);

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
    tablePlayers.forEach((p, index) => {
      const li = document.createElement('li');
      li.className = `seat-item seat-item--lobby ${tableSeatClass(index, tablePlayers.length)}`;
      if (p.id === myPlayerId) li.classList.add('is-me');
      li.innerHTML = `
        <div class="seat-avatar" aria-hidden="true">${avatarForPlayer(p)}</div>
        <div class="seat-head"><strong>${p.name}</strong>${p.isHost ? '<span class="tag tag-host">房主</span>' : ''}${p.online ? '' : '<span class="tag tag-fold">离线</span>'}</div>
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
    const onlineCount = countOnlinePlayers(players);
    const isHost = gameState.hostPlayerId === myPlayerId;
    els.btnStartHand.hidden = false;
    els.btnStartHand.disabled = startHandPending || onlineCount < 2 || !isHost;
    els.btnStartHand.textContent = startHandPending
      ? '正在开始…'
      : isHost
        ? '开始新一局'
        : '等待房主开始';
    els.actionBar.hidden = true;
    els.actionHint.hidden = false;
    els.actionHint.textContent = !isHost
      ? '等待房主开始新一局'
      : onlineCount < 2
        ? '至少 2 人在线才能开始'
        : '房间已就绪，可以开始';
    els.allInConfirm.hidden = true;
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
  els.mySeatPanel.hidden = !mySeat;
  els.mySeatName.textContent = mySeat?.name || '我';
  els.mySeatMeta.textContent = mySeat
    ? `筹码 ${mySeat.chips} · 本轮 ${mySeat.bet}${mySeat.folded ? ' · 已弃牌' : ''}${mySeat.allIn ? ' · 全下' : ''}`
    : '旁观中';
  renderCards(els.myCards, mySeat?.holeCards || []);

  els.seatList.innerHTML = '';
  const tableSeats = orderSeatsForTable(hand.seats);
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
    if (seat.isDealer) li.classList.add('is-dealer');
    if (winnerIds.has(seat.id)) li.classList.add('is-winner');
    if (isShowdown && showdownIds.has(seat.id) && !seat.folded) li.classList.add('is-revealed');

    li.innerHTML = `
      <div class="seat-avatar" aria-hidden="true">${avatarForPlayer(seat)}</div>
      <div class="seat-head">
        <strong>${seat.name}</strong>
        ${seat.isDealer ? '<span class="tag">D</span>' : ''}
        ${seat.isSmallBlind ? '<span class="tag">SB</span>' : ''}
        ${seat.isBigBlind ? '<span class="tag">BB</span>' : ''}
      </div>
      <div class="seat-meta">${seat.chips}</div>
      <div class="seat-status-row">
        ${seat.folded ? '<span class="tag tag-fold">弃</span>' : ''}
        ${seat.allIn ? '<span class="tag">全下</span>' : ''}
        ${seat.online === false ? '<span class="tag tag-fold">离线</span>' : ''}
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
  const onlineCount = countOnlinePlayers(players);
  const canStartNew = hand.canStart && onlineCount >= 2 && !inHand;
  const isHost = gameState.hostPlayerId === myPlayerId;
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
      : onlineCount < 2
        ? '至少 2 人在线才能开始'
        : '本局已结束，可开始新一局';
  }
  els.actionHint.hidden = !(inHand || canStartNew);
  syncDockVisibility();
}

function clearRoomView() {
  betPanelOpen = false;
  resetResultPanelTiming();
  lastRenderedHandPhase = null;
  document.body.classList.remove('bet-panel-open');
  setEntryMode();
  setDockVisible(false);
  els.seatList.innerHTML = '';
  els.mySeatPanel.hidden = true;
  els.allInConfirm.hidden = true;
  clearActionTimer();
}

socket.on('connect', () => {
  setStatus('已连接', 'online');
  setLobbyButtonsEnabled(true);

  if (currentSession?.roomId && currentSession?.playerId && currentSession?.token) {
    setMessage('正在恢复房间状态…');
    socket.emit('room:resume', currentSession, (res) => {
      if (!res?.ok) {
        saveSession(null);
        clearRoomView();
        setMessage(res?.error || '恢复失败，请重新加入房间', 'error');
        return;
      }
      rememberSession(res);
      renderGameState(res.gameState);
      setMessage(`已恢复房间 ${res.gameState.roomId}`, 'success');
    });
    return;
  }

  setEntryMode();
  setMessage('Socket 连接成功', 'success');
});

socket.on('disconnect', () => {
  setStatus('已断开', 'offline');
  setMessage('连接已断开，正在等待自动重连…');
  setLobbyButtonsEnabled(false);
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

els.btnStartHand.addEventListener('click', () => {
  if (els.btnStartHand.disabled || startHandPending) return;
  if (!socket.connected) {
    showRoomNotice('连接已断开，请等待重连', 'error');
    return;
  }

  startHandPending = true;
  els.btnStartHand.disabled = true;
  els.btnStartHand.textContent = '正在开始…';
  socket.emit('game:start', {}, (res) => {
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
