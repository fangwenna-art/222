function resolveServerUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('server')) return params.get('server');

  const { protocol, hostname, port } = window.location;
  if (protocol === 'https:' || port === '3010') {
    return window.location.origin;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3010';
  }
  return `${protocol}//${hostname}:3010`;
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
  winnersBox: $('winnersBox'),
  winnersList: $('winnersList'),
  actionLogBox: $('actionLogBox'),
  actionLogList: $('actionLogList'),
  btnToggleLogs: $('btnToggleLogs'),
  lastActionText: $('lastActionText'),
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
let actionLogOpen = false;
let lastHandResultSignature = '';
let dockResizeObserver = null;

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

function shortTableMessage(hand) {
  if (!hand) return '等待玩家入座';
  if (hand.phase === 'ended') {
    const winners = hand.winners || [];
    if (!winners.length) return '本局结束';
    if (winners.length === 1) return `${winners[0].name} 获胜`;
    const uniqueNames = [...new Set(winners.map((w) => w.name))];
    if (uniqueNames.length === 1) return `${uniqueNames[0]} 获胜`;
    return `本局结束 · ${uniqueNames.length} 位赢家`;
  }
  const activeSeat = hand.seats?.find((seat) => seat.id === hand.activePlayerId);
  if (activeSeat) return `轮到 ${activeSeat.name}`;
  return PHASE_LABEL[hand.phase] || hand.message || '—';
}

function formatWinnerDetail(winner) {
  const parts = [];
  if (winner.handName) parts.push(winner.handName);
  if (winner.reason) parts.push(winner.reason);
  if (winner.potAmount && winner.potAmount !== winner.amount) parts.push(`奖池 ${winner.potAmount}`);
  if (winner.split) parts.push('平分');
  return parts.join(' · ') || '获胜';
}

function handNameForPlayer(winners, playerId) {
  return winners.find((w) => w.id === playerId)?.handName || '';
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

function renderWinnerSummary(hand) {
  const winners = hand?.winners;
  els.winnersBox.hidden = !winners?.length;
  els.winnersList.innerHTML = '';
  if (!winners?.length) return;

  const seatById = new Map((hand.seats || []).map((seat) => [seat.id, seat]));
  const kicker = winners.length > 1 ? `本局结果 · ${winners.length} 项结算` : '本局结果';
  const isShowdown = winners.some((winner) => winner.handName);

  if (winners.length === 1) {
    els.winnersList.appendChild(
      buildWinnerRow(winners[0], seatById.get(winners[0].id), 'winner-summary-item', !isShowdown),
    );
  } else {
    winners.forEach((winner) => {
      els.winnersList.appendChild(buildWinnerRow(winner, seatById.get(winner.id), 'winner-detail-item'));
    });
  }

  if (isShowdown) {
    const revealSeats = (hand.seats || []).filter(
      (seat) => !seat.folded && seat.holeCards?.some((card) => card !== '🂠') && seat.id !== myPlayerId,
    );
    if (revealSeats.length) {
      const header = document.createElement('li');
      header.className = 'winner-reveal-kicker';
      header.textContent = '亮牌';
      els.winnersList.appendChild(header);

      revealSeats.forEach((seat) => {
        const handName = handNameForPlayer(winners, seat.id);
        const li = document.createElement('li');
        li.className = 'winner-reveal-item';
        li.innerHTML = `
          <strong>${seat.name}</strong>
          <span class="winner-reveal-hand">${handName || '—'}</span>
          ${winnerCardsHtml(seat.holeCards)}
        `;
        els.winnersList.appendChild(li);
      });
    }
  }

  const kickerEl = els.winnersBox.querySelector('.winner-kicker');
  if (kickerEl) kickerEl.textContent = kicker;
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

function renderActionTimer(hand) {
  clearActionTimer();
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

function formatActionLog(log) {
  const phase = PHASE_LABEL[log.phase] || log.phase;
  if (log.action === 'settle') {
    return `${phase} · ${log.note || '结算'}`;
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
function renderGameState(gameState) {
  if (!gameState) return;

  setScreen('room');
  setDockVisible(true);
  els.currentRoomId.textContent = gameState.roomId;
  els.roomId.value = gameState.roomId;

  const { players, hand } = gameState;
  window.__lastHandState = hand;

  els.roomPlayerSummary.textContent = `玩家 ${players.length}/9`;

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
    els.winnersBox.hidden = true;
    els.actionLogBox.hidden = true;
    els.actionLogBox.classList.remove('is-ended');
    actionLogOpen = false;
    lastHandResultSignature = '';
    clearActionTimer();
    els.btnStartHand.hidden = false;
    const isHost = gameState.hostPlayerId === myPlayerId;
    els.btnStartHand.disabled = players.length < 2 || !isHost;
    els.btnStartHand.textContent = isHost ? '开始新一局' : '等待房主开始';
    els.actionBar.hidden = true;
    els.allInConfirm.hidden = true;
    syncDockVisibility();
    return;
  }
  els.gamePhase.textContent = PHASE_LABEL[hand.phase] || hand.phase;
  const isEnded = hand.phase === 'ended';
  els.tablePotLabel.textContent = isEnded ? '本局结束' : '底池';
  els.gamePot.textContent = isEnded ? '' : String(hand.pot);
  els.gameMessage.textContent = shortTableMessage(hand);
  els.tableMessage.textContent = shortTableMessage(hand);
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

  renderWinnerSummary(hand);
  els.winnersBox.classList.toggle('is-ended', isEnded);

  if (hand.actionLogs?.length && hand.phase !== 'waiting') {
    const hasResultLogs = hand.actionLogs.some((log) => log.action === 'settle' || log.action === 'win');
    els.actionLogBox.classList.toggle('is-ended', isEnded && hasResultLogs);
    const resultSignature = handResultSignature(hand);
    if (resultSignature && resultSignature !== lastHandResultSignature) {
      if (hasResultLogs) actionLogOpen = true;
      lastHandResultSignature = resultSignature;
    }
    if (hand.canStart) lastHandResultSignature = '';

    els.actionLogBox.hidden = false;
    const logs = hand.actionLogs.slice().reverse();
    els.lastActionText.textContent = formatActionLog(logs[0]).replace(/^.*? · /, '');
    els.actionLogList.hidden = !actionLogOpen;
    els.btnToggleLogs.classList.toggle('is-open', actionLogOpen);
    els.actionLogList.innerHTML = '';
    logs.forEach((log) => {
      const li = document.createElement('li');
      if (log.action === 'settle') li.classList.add('is-settle');
      li.textContent = formatActionLog(log);
      els.actionLogList.appendChild(li);
    });
  } else {
    els.actionLogBox.hidden = true;
    els.actionLogBox.classList.remove('is-ended');
    actionLogOpen = false;
    if (!hand || hand.canStart) lastHandResultSignature = '';
  }

  const canStart = hand.canStart && players.length >= 2;
  const isHost = gameState.hostPlayerId === myPlayerId;
  els.btnStartHand.hidden = !canStart;
  els.btnStartHand.disabled = !canStart || !isHost;
  els.btnStartHand.textContent = isHost ? '开始新一局' : '等待房主开始';

  const actions = hand.availableActions || {};
  const myTurn = Boolean(actions.isActive);
  const inHand = hand.phase !== 'waiting' && hand.phase !== 'ended';
  if (!myTurn || !inHand) els.allInConfirm.hidden = true;
  const hasAmountAction = Boolean(actions.canBet || actions.canRaise);
  els.actionBar.hidden = !myTurn || !inHand;

  const showBetControls = myTurn && hasAmountAction && betPanelOpen;
  document.body.classList.toggle('bet-panel-open', showBetControls);
  els.betAmount.closest('.bet-controls').hidden = !showBetControls;
  updateLayoutMetrics();
  els.btnAmountToggle.hidden = !hasAmountAction;
  els.btnAmountToggle.disabled = !hasAmountAction;
  els.btnAmountToggle.classList.toggle('is-active', showBetControls);
  els.betAmount.disabled = !myTurn;
  els.betAmount.min = String(actions.canBet ? actions.minBet : actions.minRaise);
  els.betAmount.placeholder = actions.canBet ? `最小下注 ${actions.minBet}` : `最小加注 ${actions.minRaise}`;
  if (myTurn && hasAmountAction && !els.betAmount.value) {
    setBetAmount(actions.canBet ? actions.minBet : actions.minRaise);
  }

  els.btnFold.hidden = !actions.canFold;
  els.btnCheck.hidden = !actions.canCheck;
  els.btnBet.hidden = !actions.canBet;
  els.btnCall.hidden = !actions.canCall;
  els.btnRaise.hidden = !actions.canRaise;
  els.btnAllIn.hidden = !actions.canAllIn;

  els.btnFold.disabled = !actions.canFold;
  els.btnCheck.disabled = !actions.canCheck;
  els.btnBet.disabled = !actions.canBet;
  els.btnCall.disabled = !actions.canCall;
  els.btnRaise.disabled = !actions.canRaise;
  els.btnAllIn.disabled = !actions.canAllIn;
  els.btnHalfPot.disabled = !myTurn;
  els.btnPot.disabled = !myTurn;
  els.btnDouble.disabled = !myTurn;
  els.btnTriple.disabled = !myTurn;

  els.btnCall.textContent = actions.toCall > 0 ? `跟注 ${actions.toCall}` : '跟注';
  els.btnCheck.textContent = '过牌';
  els.btnAllIn.textContent = '全下';
  els.btnAmountToggle.textContent = showBetControls ? '收起金额' : '调整金额';
  els.btnBet.textContent = `下注 ${getBetAmount() || actions.minBet}`;
  els.btnRaise.textContent = `加注 ${getBetAmount() || actions.minRaise}`;
  els.actionHint.textContent = actions.canRaise
    ? `跟注额 ${actions.toCall || 0} · 最小加注 ${actions.minRaise} · 可用 ${actions.maxAmount}`
    : actions.canBet
      ? `最小下注 ${actions.minBet} · 可用 ${actions.maxAmount}`
      : actions.toCall > 0
        ? `需要跟注 ${actions.toCall} · 可用 ${actions.maxAmount}`
        : '可以过牌或选择全下';
  syncDockVisibility();
}

function clearRoomView() {
  betPanelOpen = false;
  actionLogOpen = false;
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
  socket.emit('game:start', {}, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || '无法开始', 'error');
      return;
    }
    renderGameState(res.gameState);
    setMessage('新一局已开始', 'success');
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
els.btnToggleLogs.addEventListener('click', () => {
  actionLogOpen = !actionLogOpen;
  els.actionLogList.hidden = !actionLogOpen;
  els.btnToggleLogs.classList.toggle('is-open', actionLogOpen);
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
