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
  playerCount: $('playerCount'),
  lobbyCard: $('lobbyCard'),
  bottomDock: $('bottomDock'),
  gamePhase: $('gamePhase'),
  gamePot: $('gamePot'),
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
};

if (els.serverUrl) els.serverUrl.textContent = SERVER_URL;

const socket = io(SERVER_URL, {
  transports: window.location.protocol === 'https:' ? ['polling', 'websocket'] : ['websocket', 'polling'],
  reconnection: true,
});

let currentSession = loadSession();
let myPlayerId = currentSession?.playerId || null;
let betPanelOpen = false;
let actionLogOpen = false;
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

function saveSession(session) {
  currentSession = session;
  myPlayerId = session?.playerId || null;
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

function rememberSession(res) {
  if (res?.session) {
    saveSession(res.session);
    if (res.session.playerName) els.playerName.value = res.session.playerName;
    if (res.session.roomId) els.roomId.value = res.session.roomId;
  }
}

function setStatus(text, type = 'offline') {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `badge badge--${type}`;
}

function setMessage(text, type = '') {
  els.message.textContent = text;
  els.message.className = `message${type ? ` message--${type}` : ''}`;
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

function setDockVisible(visible) {
  els.bottomDock.hidden = !visible;
  document.body.classList.toggle('has-dock', visible);
  updateLayoutMetrics();
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
  const name = log.playerName || '系统';
  const amount = log.amount ? ` ${log.amount}` : '';
  const label = {
    smallBlind: '小盲',
    bigBlind: '大盲',
    fold: '弃牌',
    check: 'Check',
    call: '跟注',
    bet: '下注',
    raise: '加注',
    allin: 'All-in',
    win: '获胜',
    dealFlop: '发 Flop',
    dealTurn: '发 Turn',
    dealRiver: '发 River',
    showdown: '摊牌',
  }[log.action] || log.action;
  return `${PHASE_LABEL[log.phase] || log.phase} · ${name} ${label}${amount}${log.note ? `（${log.note}）` : ''}`;
}

function tableSeatClass(index, count) {
  if (count <= 1) return 'seat-pos-3';
  if (count === 2) return ['seat-pos-2', 'seat-pos-4'][index] || 'seat-pos-3';
  if (count === 3) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4'][index] || 'seat-pos-3';
  if (count === 4) return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-1'][index] || 'seat-pos-5';
  return ['seat-pos-3', 'seat-pos-2', 'seat-pos-4', 'seat-pos-1', 'seat-pos-5', 'seat-pos-0'][index % 6];
}

/** 仅渲染服务端 gameState */
function renderGameState(gameState) {
  if (!gameState) return;

  els.roomPanel.hidden = false;
  els.lobbyCard.hidden = true;
  setDockVisible(true);
  els.currentRoomId.textContent = gameState.roomId;
  els.roomId.value = gameState.roomId;

  const { players, hand } = gameState;
  window.__lastHandState = hand;

  els.playerCount.textContent = String(players.length);

  if (!hand) {
    els.gamePhase.textContent = '大厅';
    els.gamePot.textContent = '0';
    els.gameMessage.textContent = '至少 2 人可开始新一局';
    els.tableMessage.textContent = '等待玩家入座';
    renderCards(els.communityCards, []);
    const me = players.find((p) => p.id === myPlayerId);
    els.mySeatPanel.hidden = !me;
    els.mySeatName.textContent = me?.name || '我';
    els.mySeatMeta.textContent = me ? (me.online ? '等待开局' : '离线保留中') : '等待入局';
    renderCards(els.myCards, []);
    els.seatList.innerHTML = '';
    const tablePlayers = players.filter((p) => p.id !== myPlayerId);
    tablePlayers.forEach((p, index) => {
      const li = document.createElement('li');
      li.className = `seat-item seat-item--lobby ${tableSeatClass(index, tablePlayers.length)}`;
      if (p.id === myPlayerId) li.classList.add('is-me');
      li.innerHTML = `
        <div class="seat-head"><strong>${p.name}</strong>${p.isHost ? '<span class="tag tag-host">房主</span>' : ''}${p.online ? '' : '<span class="tag tag-fold">离线</span>'}</div>
        <div class="seat-meta">${p.online ? '等待开局' : '断线保留中'}</div>
      `;
      els.seatList.appendChild(li);
    });
    scrollToMySeat();
    els.winnersBox.hidden = true;
    els.actionLogBox.hidden = true;
    clearActionTimer();
    els.btnStartHand.hidden = false;
    const isHost = gameState.hostPlayerId === myPlayerId;
    els.btnStartHand.disabled = players.length < 2 || !isHost;
    els.btnStartHand.textContent = isHost ? '开始新一局' : '等待房主开始';
    els.actionBar.hidden = true;
    updateLayoutMetrics();
    return;
  }
  els.gamePhase.textContent = PHASE_LABEL[hand.phase] || hand.phase;
  els.gamePot.textContent = String(hand.pot);
  els.gameMessage.textContent = hand.message || '—';
  els.tableMessage.textContent = hand.message || '—';
  renderActionTimer(hand);
  renderCards(els.communityCards, hand.communityCards);

  const mySeat = hand.seats.find((seat) => seat.id === myPlayerId);
  els.mySeatPanel.hidden = !mySeat;
  els.mySeatName.textContent = mySeat?.name || '我';
  els.mySeatMeta.textContent = mySeat
    ? `筹码 ${mySeat.chips} · 本轮 ${mySeat.bet}${mySeat.folded ? ' · 已弃牌' : ''}${mySeat.allIn ? ' · All-in' : ''}`
    : '旁观中';
  renderCards(els.myCards, mySeat?.holeCards || []);

  els.seatList.innerHTML = '';
  const tableSeats = hand.seats.filter((seat) => seat.id !== myPlayerId);
  tableSeats.forEach((seat, index) => {
    const li = document.createElement('li');
    li.className = `seat-item ${tableSeatClass(index, tableSeats.length)}`;
    if (seat.id === myPlayerId) li.classList.add('is-me');
    if (seat.id === hand.activePlayerId) li.classList.add('is-active');
    if (seat.folded) li.classList.add('is-folded');
    if (seat.allIn) li.classList.add('is-allin');
    if (seat.online === false) li.classList.add('is-offline');
    if (seat.isDealer) li.classList.add('is-dealer');

    const isHost = players.find((p) => p.id === seat.id)?.isHost;
    li.innerHTML = `
      <div class="seat-head">
        <strong>${seat.name}</strong>
        ${seat.isDealer ? '<span class="tag">D</span>' : ''}
        ${seat.isSmallBlind ? '<span class="tag">SB</span>' : ''}
        ${seat.isBigBlind ? '<span class="tag">BB</span>' : ''}
      </div>
      <div class="seat-meta">筹码 ${seat.chips}</div>
      <div class="seat-status-row">
        ${isHost ? '<span class="tag tag-host">房主</span>' : ''}
        ${seat.folded ? '<span class="tag tag-fold">弃</span>' : ''}
        ${seat.allIn ? '<span class="tag">All-in</span>' : ''}
        ${seat.online === false ? '<span class="tag tag-fold">离线</span>' : ''}
      </div>
      ${seat.bet > 0 ? `<div class="bet-stack">${seat.bet}</div>` : ''}
    `;
    els.seatList.appendChild(li);
  });
  scrollToMySeat();

  if (hand.winners?.length) {
    els.winnersBox.hidden = false;
    els.winnersList.innerHTML = '';
    hand.winners.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = `${w.name} +${w.amount}（${w.handName || w.reason}）`;
      els.winnersList.appendChild(li);
    });
  } else {
    els.winnersBox.hidden = true;
  }

  if (hand.actionLogs?.length && hand.phase !== 'waiting') {
    els.actionLogBox.hidden = false;
    const logs = hand.actionLogs.slice().reverse();
    els.lastActionText.textContent = formatActionLog(logs[0]).replace(/^.*? · /, '');
    els.actionLogList.hidden = !actionLogOpen;
    els.btnToggleLogs.classList.toggle('is-open', actionLogOpen);
    els.actionLogList.innerHTML = '';
    logs.forEach((log) => {
      const li = document.createElement('li');
      li.textContent = formatActionLog(log);
      els.actionLogList.appendChild(li);
    });
  } else {
    els.actionLogBox.hidden = true;
    actionLogOpen = false;
  }

  const canStart = hand.canStart && players.length >= 2;
  const isHost = gameState.hostPlayerId === myPlayerId;
  els.btnStartHand.hidden = !canStart;
  els.btnStartHand.disabled = !canStart || !isHost;
  els.btnStartHand.textContent = isHost ? '开始新一局' : '等待房主开始';

  const actions = hand.availableActions || {};
  const myTurn = Boolean(actions.isActive);
  const inHand = hand.phase !== 'waiting' && hand.phase !== 'ended';
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
  els.btnBet.textContent = `下注 ${getBetAmount() || actions.minBet}`;
  els.btnRaise.textContent = `加注 ${getBetAmount() || actions.minRaise}`;
  updateLayoutMetrics();
}

function clearRoomView() {
  betPanelOpen = false;
  actionLogOpen = false;
  document.body.classList.remove('bet-panel-open');
  els.roomPanel.hidden = true;
  els.lobbyCard.hidden = false;
  setDockVisible(false);
  els.seatList.innerHTML = '';
  els.mySeatPanel.hidden = true;
  clearActionTimer();
  els.playerCount.textContent = '0';
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
  return els.playerName.value.trim() || '匿名玩家';
}

els.btnCreate.addEventListener('click', () => {
  if (!socket.connected) {
    setMessage('请先等待连接成功', 'error');
    return;
  }
  setMessage('正在创建房间…');
  socket.emit('room:create', { playerName: getPlayerName() }, (res) => {
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
  setMessage(`正在加入房间 ${roomId}…`);
  socket.emit('room:join', { roomId, playerName: getPlayerName() }, (res) => {
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
els.btnAllIn.addEventListener('click', () => emitAction('allin'));
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
      setMessage(res?.error || '退出失败', 'error');
      return;
    }
    saveSession(null);
    clearRoomView();
    setMessage('已退出房间', 'success');
  });
});

setLobbyButtonsEnabled(false);
setStatus('连接中…', 'offline');
