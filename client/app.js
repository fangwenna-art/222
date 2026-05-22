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
  communityCards: $('communityCards'),
  seatList: $('seatList'),
  winnersBox: $('winnersBox'),
  winnersList: $('winnersList'),
  actionLogBox: $('actionLogBox'),
  actionLogList: $('actionLogList'),
  btnStartHand: $('btnStartHand'),
  actionBar: $('actionBar'),
  btnLeaveRoom: $('btnLeaveRoom'),
  betAmount: $('betAmount'),
  btnHalfPot: $('btnHalfPot'),
  btnPot: $('btnPot'),
  btnDouble: $('btnDouble'),
  btnTriple: $('btnTriple'),
  btnFold: $('btnFold'),
  btnCheck: $('btnCheck'),
  btnBet: $('btnBet'),
  btnCall: $('btnCall'),
  btnRaise: $('btnRaise'),
  btnAllIn: $('btnAllIn'),
};

els.serverUrl.textContent = SERVER_URL;

const socket = io(SERVER_URL, {
  transports: window.location.protocol === 'https:' ? ['polling', 'websocket'] : ['websocket', 'polling'],
  reconnection: true,
});

let currentSession = loadSession();
let myPlayerId = currentSession?.playerId || null;

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
}

function scrollToMySeat() {
  const me = els.seatList.querySelector('.seat-item.is-me');
  if (me) {
    me.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
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
    renderCards(els.communityCards, []);
    els.seatList.innerHTML = '';
    players.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'seat-item seat-item--lobby';
      if (p.id === myPlayerId) li.classList.add('is-me');
      li.innerHTML = `
        <div class="seat-head"><strong>${p.name}</strong>${p.online ? '' : '<span class="tag tag-fold">离线</span>'}</div>
        <div class="seat-meta">${p.online ? '等待开局' : '断线保留中'}</div>
      `;
      els.seatList.appendChild(li);
    });
    scrollToMySeat();
    els.winnersBox.hidden = true;
    els.actionLogBox.hidden = true;
    els.btnStartHand.hidden = false;
    els.btnStartHand.disabled = players.length < 2;
    els.actionBar.hidden = true;
    return;
  }
  els.gamePhase.textContent = PHASE_LABEL[hand.phase] || hand.phase;
  els.gamePot.textContent = String(hand.pot);
  els.gameMessage.textContent = hand.message || '—';
  renderCards(els.communityCards, hand.communityCards);

  els.seatList.innerHTML = '';
  hand.seats.forEach((seat) => {
    const li = document.createElement('li');
    li.className = 'seat-item';
    if (seat.id === myPlayerId) li.classList.add('is-me');
    if (seat.id === hand.activePlayerId) li.classList.add('is-active');
    if (seat.folded) li.classList.add('is-folded');
    if (seat.allIn) li.classList.add('is-allin');
    if (seat.online === false) li.classList.add('is-offline');
    if (seat.isDealer) li.classList.add('is-dealer');

    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'seat-cards';
    renderCards(cardsDiv, seat.holeCards);

    li.innerHTML = `
      <div class="seat-head">
        <strong>${seat.name}</strong>
        ${seat.isDealer ? '<span class="tag">D</span>' : ''}
        ${seat.isSmallBlind ? '<span class="tag">SB</span>' : ''}
        ${seat.isBigBlind ? '<span class="tag">BB</span>' : ''}
        ${seat.folded ? '<span class="tag tag-fold">弃</span>' : ''}
        ${seat.allIn ? '<span class="tag">All-in</span>' : ''}
        ${seat.online === false ? '<span class="tag tag-fold">离线</span>' : ''}
      </div>
      <div class="seat-meta">筹码 ${seat.chips} · 本轮 ${seat.bet}</div>
    `;
    li.appendChild(cardsDiv);
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

  if (hand.actionLogs?.length) {
    els.actionLogBox.hidden = false;
    els.actionLogList.innerHTML = '';
    hand.actionLogs.slice().reverse().forEach((log) => {
      const li = document.createElement('li');
      li.textContent = formatActionLog(log);
      els.actionLogList.appendChild(li);
    });
  } else {
    els.actionLogBox.hidden = true;
  }

  const canStart = hand.canStart && players.length >= 2;
  els.btnStartHand.hidden = !canStart;
  els.btnStartHand.disabled = !canStart;

  const myTurn = hand.activePlayerId === myPlayerId;
  const inHand = hand.phase !== 'waiting' && hand.phase !== 'ended';
  els.actionBar.hidden = !myTurn || !inHand;

  const mySeat = hand.seats.find((s) => s.id === myPlayerId);
  const toCall = mySeat ? Math.max(0, hand.currentBet - mySeat.bet) : 0;
  const minBet = hand.minBet || hand.bigBlind || 20;
  const minRaise = hand.minRaise || 20;
  const canCheckOrBet = myTurn && toCall === 0;
  const canCallOrRaise = myTurn && toCall > 0;

  els.betAmount.disabled = !myTurn;
  els.betAmount.min = String(canCheckOrBet ? minBet : minRaise);
  els.betAmount.placeholder = canCheckOrBet ? `最小下注 ${minBet}` : `最小加注 ${minRaise}`;

  els.btnFold.disabled = !myTurn;
  els.btnCheck.disabled = !canCheckOrBet;
  els.btnBet.disabled = !canCheckOrBet;
  els.btnCall.disabled = !canCallOrRaise;
  els.btnRaise.disabled = !canCallOrRaise;
  els.btnAllIn.disabled = !myTurn || !mySeat || mySeat.chips <= 0;
  els.btnHalfPot.disabled = !myTurn;
  els.btnPot.disabled = !myTurn;
  els.btnDouble.disabled = !myTurn;
  els.btnTriple.disabled = !myTurn;

  els.btnCall.textContent = toCall > 0 ? `跟注 ${toCall}` : '跟注';
  els.btnBet.textContent = `下注 ≥${minBet}`;
  els.btnRaise.textContent = `加注 ≥${minRaise}`;
}

function clearRoomView() {
  els.roomPanel.hidden = true;
  els.lobbyCard.hidden = false;
  setDockVisible(false);
  els.seatList.innerHTML = '';
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
  if (!hand) return;
  const mySeat = hand.seats.find((s) => s.id === myPlayerId);
  if (!mySeat) return;
  const toCall = Math.max(0, hand.currentBet - mySeat.bet);
  const base = multiplier === 'halfPot'
    ? Math.ceil(hand.pot / 2)
    : multiplier === 'pot'
      ? hand.pot
      : hand.bigBlind * multiplier;
  const minimum = toCall > 0 ? hand.minRaise || hand.bigBlind : hand.minBet || hand.bigBlind;
  setBetAmount(Math.min(mySeat.chips, Math.max(minimum, base)));
}

function emitAction(action, amount) {
  socket.emit('game:action', { action, amount }, (res) => {
    if (!res?.ok) {
      setMessage(res?.error || '操作失败', 'error');
      return;
    }
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
els.btnHalfPot.addEventListener('click', () => quickBet('halfPot'));
els.btnPot.addEventListener('click', () => quickBet('pot'));
els.btnDouble.addEventListener('click', () => quickBet(2));
els.btnTriple.addEventListener('click', () => quickBet(3));
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
