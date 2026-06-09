/**
 * Truth or Dare 2.0 — Game Server  (v2)
 * Express + Socket.io, web multiplayer
 */

'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');

const { cards: ALL_CARDS } = require('./data/dares.json');
const { selectCard } = require('./lib/selectCard');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || null;

if (!BASE_URL) {
  console.warn('[warn] BASE_URL not set — QR codes will use local IP (fine for LAN, wrong on Railway)');
}

const ALL_TAGS = ['general', 'flirty', 'clothing', 'body', 'physical', 'feet', 'mouth', 'oral', 'intimate', 'explicit'];
const EMOJIS   = ['🦊','🐱','🐶','🦁','🐯','🦋','🐝','🦄','🐸','🐙','🦀','🌙','⭐','🍓','🌹'];

// ─── Room Store ───────────────────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
  while (rooms[code]); // retry on collision
  return code;
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function createRoom(hostId) {
  const code = generateCode();
  rooms[code] = {
    code,
    host: hostId,           // kept as 'host' per CLAUDE.md §7.6
    phase: 'lobby',
    players: {},
    turnOrder: [],
    currentTurnIndex: 0,
    currentTurn: null,      // { targetId, performerId, choice, card, phase }
    // Host config
    minStartLevel: 1,
    rouletteMode: 'off',
    targetingMode: '50-50',
    economyMode: 'schaars',
    enabledPowerups: [],
    activeEvent: null,
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code]; }

// ─── Progression helpers ──────────────────────────────────────────────────────

function coinsByEconomy(baseCoins, mode) {
  if (mode === 'gemiddeld')   return baseCoins * 2;
  if (mode === 'overvloedig') return baseCoins * 4;
  return baseCoins; // schaars
}

// XP needed to unlock level N (both: xp >= N*6 AND prev level cleared)
function canAccessLevel(player, level) {
  if (level <= 1) return true;
  const prev = level - 1;
  const xpThreshold = level * 6;
  const hasXp      = player.xp >= xpThreshold;
  const hasCleared = player.clearedLevels.includes(prev);
  return hasXp && hasCleared;
}

// ─── Public state (never expose limits) ──────────────────────────────────────
function roomPublicState(room) {
  const publicPlayers = {};
  for (const [id, p] of Object.entries(room.players)) {
    publicPlayers[id] = {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      clothingItems: p.clothingItems,
      preferences: p.preferences,
      ready: p.ready,
      isHost: id === room.host,
      // Progression (safe to broadcast)
      xp: p.xp,
      coins: p.coins,
      currentLevel: p.currentLevel,
      clearedLevels: p.clearedLevels,
      breakSlots: { total: p.breakSlots.total, used: p.breakSlots.used },
      immunity: p.immunity,
      // limits: NEVER sent
    };
  }
  return {
    code: room.code,
    phase: room.phase,
    players: publicPlayers,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    currentTurn: room.currentTurn,
    targetingMode: room.targetingMode,
    economyMode: room.economyMode,
    minStartLevel: room.minStartLevel,
  };
}

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Host creates a room
  socket.on('create-room', (cb) => {
    const room = createRoom(socket.id);
    socket.join(room.code);
    console.log(`[room] Created ${room.code} by ${socket.id}`);
    cb({ ok: true, code: room.code });
  });

  // Player joins a room
  socket.on('join-room', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.phase === 'game') return cb({ ok: false, error: 'Game already in progress' });
    socket.join(code);
    socket.data.roomCode = code;
    console.log(`[room] ${socket.id} joined ${code}`);
    cb({ ok: true, code });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Player submits setup (name, clothingItems, prefs, limits)
  socket.on('player-setup', ({ code, name, clothing, preferences, limits }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const emojiIdx = Object.keys(room.players).length % EMOJIS.length;
    room.players[socket.id] = {
      id: socket.id,
      name,
      emoji: EMOJIS[emojiIdx],
      clothingItems: clothing,   // renamed from 'clothing'
      preferences: preferences || [],
      limits: limits || [],      // PRIVATE: never broadcast
      ready: false,
      // Progression
      xp: 0,
      coins: 0,
      currentLevel: 1,
      clearedLevels: [],
      daresCompletedPerLevel: {},
      usedCardIds: new Set(),    // per-player, not per-room
      breakSlots: { total: 3, used: 0, parkedDares: [] },
      immunity: 0,
      activePowerups: [],
      // Phase 5 stubs (not in setup UI yet)
      gender: null,
      bodyType: null,
      orientation: 'bi',
      availableForAllCombos: false,
    };
    socket.data.roomCode = code;
    cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Player marks themselves ready
  socket.on('player-ready', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || !room.players[socket.id]) return cb && cb({ ok: false });
    room.players[socket.id].ready = true;
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Host starts the game
  socket.on('start-game', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.host !== socket.id) return cb({ ok: false, error: 'Only the host can start' });
    const playerIds = Object.keys(room.players);
    if (playerIds.length < 2) return cb({ ok: false, error: 'Need at least 2 players' });

    room.phase = 'game';
    room.turnOrder = playerIds.sort(() => Math.random() - 0.5);
    room.currentTurnIndex = 0;
    room.currentTurn = { targetId: null, performerId: null, choice: null, card: null, phase: 'spinning' };
    cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Spin result: pick target/performer for this round
  socket.on('request-spin', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return;
    const performerId = room.turnOrder[room.currentTurnIndex % room.turnOrder.length];
    room.currentTurn = { targetId: performerId, performerId, choice: null, card: null, phase: 'choosing' };
    cb && cb({ ok: true, targetId: performerId });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Player chooses their level for this turn
  socket.on('choose-level', ({ code, level }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    const player = room.players[socket.id];
    if (!player) return cb && cb({ ok: false, error: 'Player not found' });
    if (room.currentTurn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });

    const lvl = parseInt(level, 10);
    if (!lvl || lvl < 1 || lvl > 10) return cb && cb({ ok: false, error: 'Invalid level' });
    if (!canAccessLevel(player, lvl)) {
      return cb && cb({ ok: false, error: `Level ${lvl} not yet unlocked` });
    }

    player.currentLevel = lvl;
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Chosen player picks Truth or Dare
  socket.on('pick-truth-dare', ({ code, choice }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentTurn) return;
    if (room.currentTurn.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });

    const performer = room.players[socket.id];
    const target = room.currentTurn.targetId !== socket.id
      ? room.players[room.currentTurn.targetId]
      : null;

    const level = performer.currentLevel || 1;

    const { card, recycled } = selectCard(
      ALL_CARDS, choice, performer, target, level,
      performer.usedCardIds,
      { rouletteMode: room.rouletteMode }
    );

    if (card) performer.usedCardIds.add(card.id);

    room.currentTurn.choice = choice;
    room.currentTurn.card = card;
    room.currentTurn.phase = 'showing';
    room.currentTurn.recycled = recycled;

    cb && cb({ ok: true, recycled });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Performer marks dare complete — award XP and coins
  socket.on('complete-dare', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    const performer = room.players[socket.id];
    if (!performer) return cb && cb({ ok: false });
    const card = room.currentTurn?.card;
    if (!card) return cb && cb({ ok: false });

    const xpEarned    = card.level * (card.difficulty || 1);
    const baseCoins   = Math.max(3, card.level + (card.difficulty || 1));
    const coinsEarned = coinsByEconomy(baseCoins, room.economyMode);

    performer.xp     += xpEarned;
    performer.coins  += coinsEarned;

    // Track progress toward clearing this level
    const lvl = card.level;
    performer.daresCompletedPerLevel[lvl] = (performer.daresCompletedPerLevel[lvl] || 0) + 1;
    if (
      performer.daresCompletedPerLevel[lvl] >= 3 &&
      !performer.clearedLevels.includes(lvl)
    ) {
      performer.clearedLevels.push(lvl);
    }

    console.log(`[xp] ${performer.name} +${xpEarned}xp +${coinsEarned}coins (level ${lvl})`);
    cb && cb({ ok: true, xpEarned, coinsEarned });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Move to next turn
  socket.on('next-turn', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return;
    room.currentTurnIndex++;
    room.currentTurn = { targetId: null, performerId: null, choice: null, card: null, phase: 'spinning' };
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;
    delete room.players[socket.id];
    room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      console.log(`[room] ${code} closed (empty)`);
    } else {
      if (room.host === socket.id) room.host = Object.keys(room.players)[0];
      io.to(code).emit('room-state', roomPublicState(room));
    }
    console.log(`[disconnect] ${socket.id} from ${code}`);
  });
});

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/qr/:code', async (req, res) => {
  const base = BASE_URL || `http://${getLocalIP()}:${PORT}`;
  const url = `${base}?room=${req.params.code}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).send('QR error');
  }
});

app.get('/tags', (req, res) => res.json(ALL_TAGS));

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const base = BASE_URL || `http://${getLocalIP()}:${PORT}`;
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Truth or Dare 2.0  🔥  Server Up   ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Local:   http://localhost:${PORT}       ║`);
  console.log(`║  Join:    ${base}  ║`);
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
