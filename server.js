const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const C = require('./public/checkers.js');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

/* ---------- состояние комнат ---------- */

const rooms = new Map();

function freshVideo() {
  return { url: '', playing: false, time: 0, ts: Date.now(), by: '', action: '' };
}
function freshGame() {
  return {
    board: null, turn: 'w', seats: { w: null, b: null }, names: {},
    scores: {}, draws: 0, status: 'idle', winner: null, lastMove: null,
    moveNo: 0, gameNo: 0, drawOffer: null,
  };
}
function makeRoom(saved = {}) {
  const video = { ...freshVideo(), ...(saved.video || {}) };
  if (video.playing) { // после перезапуска сервера — ставим на паузу там, где остановились
    video.time = video.time + (Date.now() - video.ts) / 1000;
    video.playing = false;
    video.ts = Date.now();
  }
  return {
    video,
    chat: Array.isArray(saved.chat) ? saved.chat.slice(-200) : [],
    game: { ...freshGame(), ...(saved.game || {}) },
    users: new Map(),
  };
}

try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const [id, r] of Object.entries(saved)) rooms.set(id, makeRoom(r));
  console.log(`Загружено комнат: ${rooms.size}`);
} catch { /* первый запуск */ }

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, makeRoom());
  return rooms.get(id);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const [id, r] of rooms) out[id] = { video: r.video, chat: r.chat.slice(-200), game: r.game };
    const tmp = DATA_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(out), (err) => {
      if (!err) fs.rename(tmp, DATA_FILE, () => {});
    });
  }, 1500);
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function userList(room) {
  const byId = new Map();
  for (const u of room.users.values()) byId.set(u.id, { id: u.id, name: u.name });
  return [...byId.values()];
}

/* ---------- сокеты ---------- */

io.on('connection', (socket) => {
  let rid = null;
  let room = null;
  let me = null;

  const pushChat = (msg) => {
    const m = { id: Math.random().toString(36).slice(2, 10), ts: Date.now(), ...msg };
    room.chat.push(m);
    if (room.chat.length > 300) room.chat.splice(0, room.chat.length - 300);
    io.to(rid).emit('chat', m);
    save();
  };
  const sys = (text) => pushChat({ sys: true, text });
  const emitGame = () => { io.to(rid).emit('game', room.game); save(); };
  const seatOf = () => {
    const g = room.game;
    if (g.seats[g.turn] === me.id) return g.turn; // если сидишь за обоих — ходит тот, чей ход
    if (g.seats.w === me.id) return 'w';
    if (g.seats.b === me.id) return 'b';
    return null;
  };
  const colorName = (c) => (c === 'w' ? 'белые' : 'чёрные');
  const nameOf = (id) => (id && room.game.names[id]) || 'Игрок';

  function startGame() {
    const g = room.game;
    Object.assign(g, {
      board: C.initialBoard(), turn: 'w', status: 'playing', winner: null,
      lastMove: null, moveNo: 0, drawOffer: null, gameNo: (g.gameNo || 0) + 1,
    });
    sys(`Партия №${g.gameNo}: белые — ${nameOf(g.seats.w)}, чёрные — ${nameOf(g.seats.b)}`);
    emitGame();
  }

  function finish(winner, reason) {
    const g = room.game;
    g.status = 'over';
    g.winner = winner;
    g.drawOffer = null;
    if (winner === 'draw') {
      g.draws = (g.draws || 0) + 1;
      sys('Партия закончилась вничью');
    } else {
      const id = g.seats[winner];
      g.scores[id] = (g.scores[id] || 0) + 1;
      sys(`${nameOf(id)} выигрывает за ${colorName(winner)}${reason ? ` (${reason})` : ''}`);
    }
    emitGame();
  }

  socket.on('hello', (data, ack) => {
    if (typeof ack !== 'function') return;
    const newRid = clean(data && data.room, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const id = clean(data && data.clientId, 64);
    if (!newRid || !id) return ack({ ok: false });
    if (room && rid) { room.users.delete(socket.id); socket.leave(rid); }
    rid = newRid;
    room = getRoom(rid);
    me = { id, name: clean(data.name, 24) || 'Гость' };
    socket.join(rid);
    const wasHere = userList(room).some((u) => u.id === id);
    room.users.set(socket.id, me);
    room.game.names[id] = me.name;
    ack({
      ok: true, serverNow: Date.now(), video: room.video,
      chat: room.chat.slice(-150), game: room.game, users: userList(room),
    });
    io.to(rid).emit('users', userList(room));
    if (!wasHere) socket.to(rid).emit('joined', { name: me.name });
  });

  socket.on('clock', (_d, ack) => { if (typeof ack === 'function') ack(Date.now()); });

  socket.on('disconnect', () => {
    if (!room) return;
    room.users.delete(socket.id);
    io.to(rid).emit('users', userList(room));
  });

  /* --- видео --- */
  socket.on('video:set', (data) => {
    if (!room) return;
    const url = clean(data && data.url, 2000);
    if (url && !/^https?:\/\//i.test(url)) return;
    room.video = { url, playing: false, time: 0, ts: Date.now(), by: me.name, action: 'set', actor: socket.id };
    io.to(rid).emit('video', room.video);
    if (url) sys(`${me.name} включает новое видео`);
    save();
  });

  socket.on('video:state', (data) => {
    if (!room || !room.video.url) return;
    const time = Math.max(0, Number(data && data.time) || 0);
    const playing = !!(data && data.playing);
    const action = ['play', 'pause', 'seek'].includes(data && data.action) ? data.action : (playing ? 'play' : 'pause');
    room.video = { ...room.video, playing, time, ts: Date.now(), by: me.name, action, actor: socket.id };
    io.to(rid).emit('video', room.video);
    save();
  });

  socket.on('video:get', (_d, ack) => { if (room && typeof ack === 'function') ack({ video: room.video, serverNow: Date.now() }); });

  /* --- чат --- */
  socket.on('chat', (data) => {
    if (!room) return;
    const text = clean(data && data.text, 500);
    if (!text) return;
    pushChat({ clientId: me.id, name: me.name, text });
  });
  socket.on('typing', () => { if (room) socket.to(rid).emit('typing', { name: me.name }); });
  socket.on('react', () => { if (room) io.to(rid).emit('react', { name: me.name, actor: socket.id }); });

  /* --- шашки --- */
  socket.on('game:sit', (data) => {
    if (!room) return;
    const g = room.game;
    const color = data && data.color;
    if (color !== 'w' && color !== 'b') return;
    if (g.status === 'playing') return;
    if (g.seats[color] && g.seats[color] !== me.id) {
      const online = userList(room).some((u) => u.id === g.seats[color]);
      if (online) return;
    }
    g.seats[color] = me.id;
    g.names[me.id] = me.name;
    emitGame();
  });

  socket.on('game:stand', () => {
    if (!room) return;
    const g = room.game;
    if (g.status === 'playing') return;
    for (const c of ['w', 'b']) if (g.seats[c] === me.id) g.seats[c] = null;
    emitGame();
  });

  socket.on('game:swap', () => {
    if (!room) return;
    const g = room.game;
    if (g.status === 'playing') return;
    g.seats = { w: g.seats.b, b: g.seats.w };
    emitGame();
  });

  socket.on('game:start', () => {
    if (!room) return;
    const g = room.game;
    if (g.status === 'playing' || !g.seats.w || !g.seats.b) return;
    if (g.seats.w !== me.id && g.seats.b !== me.id) return;
    if (g.status === 'over') g.seats = { w: g.seats.b, b: g.seats.w }; // перемена цвета
    startGame();
  });

  socket.on('game:move', (data, ack) => {
    const reply = (r) => { if (typeof ack === 'function') ack(r); };
    if (!room) return reply({ ok: false });
    const g = room.game;
    if (g.status !== 'playing') return reply({ ok: false, error: 'Партия не идёт' });
    if (g.seats[g.turn] !== me.id) return reply({ ok: false, error: 'Сейчас не твой ход' });
    const pathIn = Array.isArray(data && data.path) ? data.path : [];
    const p = pathIn.map((sq) => [Number(sq && sq[0]), Number(sq && sq[1])]);
    const move = C.legalMoves(g.board, g.turn).find((m) => C.samePath(m.path, p));
    if (!move) return reply({ ok: false, error: 'Так ходить нельзя' });
    const mover = g.turn;
    g.board = C.applyMove(g.board, move);
    g.lastMove = { path: move.path, captures: move.captures, color: mover };
    g.turn = C.opp(mover);
    g.moveNo += 1;
    g.drawOffer = null;
    reply({ ok: true });
    if (C.legalMoves(g.board, g.turn).length === 0) {
      const noPieces = C.countPieces(g.board, g.turn) === 0;
      finish(mover, noPieces ? 'все шашки соперника сбиты' : 'у соперника нет ходов');
    } else {
      emitGame();
    }
  });

  socket.on('game:resign', () => {
    if (!room) return;
    const g = room.game;
    if (g.status !== 'playing') return;
    const c = seatOf();
    if (!c) return;
    finish(C.opp(c), `${nameOf(me.id)} сдаётся`);
  });

  socket.on('game:draw', (data) => {
    if (!room) return;
    const g = room.game;
    if (g.status !== 'playing') return;
    const c = seatOf();
    if (!c) return;
    const action = data && data.action;
    if (action === 'offer' && !g.drawOffer) {
      g.drawOffer = c;
      sys(`${me.name} предлагает ничью`);
      emitGame();
    } else if (action === 'accept' && g.drawOffer && (g.drawOffer !== c || g.seats.w === g.seats.b)) {
      finish('draw');
    } else if (action === 'decline' && g.drawOffer) {
      g.drawOffer = null;
      sys(`${me.name} отклоняет ничью`);
      emitGame();
    }
  });

  socket.on('game:reset-score', () => {
    if (!room) return;
    const g = room.game;
    if (g.seats.w !== me.id && g.seats.b !== me.id) return;
    g.scores = {};
    g.draws = 0;
    sys(`${me.name} обнуляет счёт`);
    emitGame();
  });
});

server.listen(PORT, () => {
  console.log(`Наш уголок работает: http://localhost:${PORT}`);
});
