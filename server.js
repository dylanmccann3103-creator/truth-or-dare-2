/**
 * Truth or Dare 2.0 — Game Server  (v2, Phase 2)
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
const { coinsByEconomy, calcRewards, applyImmunity, POWERUP_COSTS } = require('./lib/gameHelpers');

function getRoomCards(room) { return room.cardPool || ALL_CARDS; }

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
  while (rooms[code]);
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

function createRoom(hostId, hostMode = 'display') {
  const code = generateCode();
  rooms[code] = {
    code,
    host: hostId,
    hostMode,                       // 'display' | 'player'
    displayHostId: hostMode === 'display' ? hostId : null,
    phase: 'lobby',
    players: {},
    turnOrder: [],
    currentTurnIndex: -1,           // -1 so first advanceTurn yields index 0
    currentTurn: null,
    // Host config
    minStartLevel: 1,
    rouletteMode: 'off',            // 'off' | 'plus1' | 'block'
    targetingMode: '50-50',         // 'self' | '50-50' | 'random'
    economyMode: 'schaars',         // 'schaars' | 'gemiddeld' | 'overvloedig'
    enabledPowerups: [],
    activeEvent: null,
    cardPool: null,          // null = use ALL_CARDS; set from host's active packages
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code]; }

// ─── Progression helpers ──────────────────────────────────────────────────────

function canAccessLevel(player, level) {
  if (level <= 1) return true;
  const prev = level - 1;
  const xpThreshold = 3 * level * (level - 1); // cumulative max-XP across prior levels
  return player.xp >= xpThreshold && player.clearedLevels.includes(prev);
}

function maxUnlockedLevel(player) {
  for (let lvl = 10; lvl >= 1; lvl--) {
    if (canAccessLevel(player, lvl)) return lvl;
  }
  return 1;
}

// ─── Game helpers ─────────────────────────────────────────────────────────────

function pickTarget(room, performerId, excludeId = null) {
  let others = room.turnOrder.filter(id => id !== performerId && room.players[id]);
  if (excludeId) others = others.filter(id => id !== excludeId);
  if (others.length === 0) return (excludeId ? null : performerId);

  const mode = room.targetingMode;
  if (mode === 'self') return performerId;
  if (mode === 'random') return others[Math.floor(Math.random() * others.length)];
  // '50-50': half chance self, half chance random other
  return Math.random() < 0.5
    ? performerId
    : others[Math.floor(Math.random() * others.length)];
}

function advanceTurn(room) {
  room.currentTurnIndex++;
  room.currentTurn = {
    targetId: null, performerId: null,
    choice: null, card: null,
    phase: 'spinning',
    recycled: false, softFlagged: false, rouletteUpgrade: false,
    attribution: null,
    doubleXp: false,
    insightRevealed: false,
    insightType: null,
    duelAutoWinnerId: null,
    forfeit: null,
  };
  io.to(room.code).emit('room-state', roomPublicState(room));

  // After brief spin delay, resolve performer + target
  setTimeout(() => {
    if (!rooms[room.code] || room.phase !== 'game') return;
    if (room.turnOrder.length === 0) return;
    const performerId = room.turnOrder[room.currentTurnIndex % room.turnOrder.length];
    if (!room.players[performerId]) {
      // Player gone — skip ahead
      advanceTurn(room);
      return;
    }
    const targetId = pickTarget(room, performerId);
    room.currentTurn = {
      targetId, performerId,
      choice: null, card: null,
      phase: 'choosing',
      recycled: false, softFlagged: false, rouletteUpgrade: false,
      attribution: null,
      doubleXp: false,
      insightRevealed: false,
      insightType: null,
      duelAutoWinnerId: null,
      forfeit: null,
    };
    io.to(room.code).emit('room-state', roomPublicState(room));
  }, 800);
}

// ─── Public state (never expose limits) ──────────────────────────────────────
function roomPublicState(room) {
  const publicPlayers = {};
  const isEnded = room.phase === 'ended';

  for (const [id, p] of Object.entries(room.players)) {
    publicPlayers[id] = {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      clothingItems: p.clothingItems,
      preferences: p.preferences,
      softLimits: p.softLimits,    // safe to broadcast (no hard-limit info)
      ready: p.ready,
      isHost: id === room.host,
      xp: p.xp,
      coins: p.coins,
      currentLevel: p.currentLevel,
      clearedLevels: p.clearedLevels,
      breakSlots: {
        total: p.breakSlots.total,
        used: p.breakSlots.used,
        // expose parked dare details always (needed for replay UI + end-game penalty display)
        parkedDares: p.breakSlots.parkedDares.map(d => ({
          cardId: d.cardId,
          level: d.level,
          difficulty: d.difficulty,
          text: d.text,
          xpPenalty: d.xpPenalty,
        })),
      },
      immunity: p.immunity,
      activePowerups: p.activePowerups || [],
      gender: p.gender,
      bodyType: p.bodyType,
      orientation: p.orientation,
      availableForAllCombos: p.availableForAllCombos,
      // limits: NEVER sent
    };
  }
  return {
    code: room.code,
    phase: room.phase,
    hostMode: room.hostMode,
    displayHostId: room.displayHostId,
    players: publicPlayers,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    currentTurn: room.currentTurn,
    targetingMode: room.targetingMode,
    rouletteMode: room.rouletteMode,
    economyMode: room.economyMode,
    minStartLevel: room.minStartLevel,
    enabledPowerups: room.enabledPowerups || [],
  };
}

// ─── Socket.io Events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Host creates a room — passes hostMode: 'display' | 'player'
  socket.on('create-room', ({ hostMode = 'display' } = {}, cb) => {
    const room = createRoom(socket.id, hostMode);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    console.log(`[room] Created ${room.code} by ${socket.id} (${hostMode})`);
    cb({ ok: true, code: room.code, hostMode });
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

  // Player submits setup (name, clothingItems, prefs, limits, softLimits, gender, bodyType, orientation)
  socket.on('player-setup', ({ code, name, clothing, preferences, limits, limits_soft, gender, bodyType, orientation, availableForAllCombos }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const emojiIdx = Object.keys(room.players).length % EMOJIS.length;
    room.players[socket.id] = {
      id: socket.id,
      name,
      emoji: EMOJIS[emojiIdx],
      clothingItems: clothing,
      preferences: preferences || [],
      limits: limits || [],           // PRIVATE: never broadcast
      softLimits: limits_soft || [],  // safe to broadcast
      ready: false,
      xp: 0,
      coins: 0,
      currentLevel: 1,
      clearedLevels: [],
      daresCompletedPerLevel: {},
      usedCardIds: new Set(),         // per-player, PRIVATE
      breakSlots: { total: 3, used: 0, parkedDares: [] },
      immunity: 0,
      activePowerups: [],
      gender: gender || null,
      bodyType: bodyType || null,
      orientation: orientation || 'bi',
      availableForAllCombos: availableForAllCombos || false,
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

  // Host updates game config (lobby phase only)
  socket.on('set-game-config', ({ code, targetingMode, rouletteMode, economyMode, enabledPowerups }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Only the host can configure' });
    if (room.phase !== 'lobby') return cb && cb({ ok: false, error: 'Can only configure in lobby' });

    const validTargeting = ['self', '50-50', 'random'];
    const validRoulette  = ['off', 'plus1', 'block'];
    const validEconomy   = ['schaars', 'gemiddeld', 'overvloedig'];
    const validPowerups  = Object.keys(POWERUP_COSTS);

    if (targetingMode && validTargeting.includes(targetingMode)) room.targetingMode = targetingMode;
    if (rouletteMode  && validRoulette.includes(rouletteMode))   room.rouletteMode  = rouletteMode;
    if (economyMode   && validEconomy.includes(economyMode))     room.economyMode   = economyMode;
    if (Array.isArray(enabledPowerups)) {
      room.enabledPowerups = enabledPowerups.filter(p => validPowerups.includes(p));
    }

    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Host starts the game
  socket.on('start-game', ({ code, cardPool }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.host !== socket.id) return cb({ ok: false, error: 'Only the host can start' });
    const playerIds = Object.keys(room.players);
    if (playerIds.length < 2) return cb({ ok: false, error: 'Need at least 2 players' });

    // Accept custom card pool from host's active packages (validated client-side)
    if (Array.isArray(cardPool) && cardPool.length > 0) {
      room.cardPool = cardPool;
      console.log(`[cards] Room ${code} using custom pool: ${cardPool.length} cards`);
    }

    room.phase = 'game';
    room.turnOrder = playerIds.sort(() => Math.random() - 0.5);
    room.currentTurnIndex = -1;     // advanceTurn will increment to 0
    room.currentTurn = null;
    cb({ ok: true });
    advanceTurn(room);              // kicks off the first turn
  });

  // Player chooses their level for this turn
  socket.on('choose-level', ({ code, level }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    const player = room.players[socket.id];
    if (!player) return cb && cb({ ok: false, error: 'Player not found' });
    if (room.currentTurn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
    if (room.currentTurn?.phase !== 'choosing') return cb && cb({ ok: false, error: 'Wrong phase' });

    const lvl = parseInt(level, 10);
    if (!lvl || lvl < 1 || lvl > 10) return cb && cb({ ok: false, error: 'Invalid level' });
    if (!canAccessLevel(player, lvl)) {
      return cb && cb({ ok: false, error: `Level ${lvl} not yet unlocked` });
    }

    player.currentLevel = lvl;
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Performer picks Truth or Dare — card selection with roulette + soft-limit + duel roll
  socket.on('pick-truth-dare', ({ code, choice }, cb) => {
    const room = getRoom(code);
    if (!room || !room.currentTurn) return cb && cb({ ok: false });
    if (room.currentTurn.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
    if (room.currentTurn.phase !== 'choosing') return cb && cb({ ok: false, error: 'Wrong phase' });

    const performer = room.players[socket.id];
    const targetId  = room.currentTurn.targetId;
    const target = (targetId && targetId !== socket.id) ? room.players[targetId] : null;

    // Immunity auto-roll: before card selection
    if (applyImmunity(performer)) {
      io.to(code).emit('toast', { msg: `🛡️ ${performer.name} is immune this round!` });
      return advanceTurn(room);
    }

    let effectiveLevel = performer.currentLevel || 1;
    let rouletteUpgrade = false;

    // plus1 roulette: 20% chance of bumping level, never to 10
    if (room.rouletteMode === 'plus1' && Math.random() < 0.2) {
      const bumped = effectiveLevel + 1;
      if (bumped < 10 && canAccessLevel(performer, bumped)) {
        effectiveLevel = bumped;
        rouletteUpgrade = true;
      }
    }

    const scMode = room.rouletteMode === 'block' ? 'block' : 'off';

    // Duel roll: 25% chance when choice is 'dare' and a different target exists
    if (choice === 'dare' && target && Math.random() < 0.25) {
      const duelResult = selectCard(
        getRoomCards(room), 'duel', performer, target, effectiveLevel,
        performer.usedCardIds, { rouletteMode: scMode }
      );
      if (duelResult.card) {
        performer.usedCardIds.add(duelResult.card.id);
        room.currentTurn.choice          = 'dare';
        room.currentTurn.card            = duelResult.card;
        room.currentTurn.phase           = 'duel';
        room.currentTurn.recycled        = duelResult.recycled;
        room.currentTurn.softFlagged     = false;
        room.currentTurn.rouletteUpgrade = rouletteUpgrade;
        room.currentTurn.attribution     = { type: 'duel', performerId: socket.id, targetId };
        room.currentTurn.duelAutoWinnerId = null;
        cb && cb({ ok: true, isDuel: true });
        io.to(code).emit('room-state', roomPublicState(room));
        return;
      }
    }

    const { card, recycled, softFlagged } = selectCard(
      getRoomCards(room), choice, performer, target, effectiveLevel,
      performer.usedCardIds, { rouletteMode: scMode }
    );

    if (card) performer.usedCardIds.add(card.id);

    room.currentTurn.choice          = choice;
    room.currentTurn.card            = card;
    room.currentTurn.phase           = 'showing';
    room.currentTurn.recycled        = recycled;
    room.currentTurn.softFlagged     = softFlagged;
    room.currentTurn.rouletteUpgrade = rouletteUpgrade;
    room.currentTurn.attribution     = { type: 'solo', performerId: socket.id };

    cb && cb({ ok: true, recycled, softFlagged, rouletteUpgrade });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Performer marks dare complete — award XP and coins, then auto-advance
  socket.on('complete-dare', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    const performer = room.players[socket.id];
    if (!performer) return cb && cb({ ok: false });
    if (room.currentTurn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
    if (room.currentTurn?.phase !== 'showing') return cb && cb({ ok: false, error: 'Wrong phase' });
    const card = room.currentTurn?.card;
    if (!card) return cb && cb({ ok: false });

    const { xpEarned, coinRecipients } = calcRewards(
      card, room.currentTurn.attribution, room.economyMode, room.currentTurn.doubleXp || false
    );

    performer.xp += xpEarned;

    for (const { id, coins } of coinRecipients) {
      if (room.players[id]) room.players[id].coins += coins;
    }

    const coinsEarned = coinRecipients.find(r => r.id === socket.id)?.coins || 0;

    // Track level clearing
    const lvl = card.level;
    performer.daresCompletedPerLevel[lvl] = (performer.daresCompletedPerLevel[lvl] || 0) + 1;
    if (performer.daresCompletedPerLevel[lvl] >= 3 && !performer.clearedLevels.includes(lvl)) {
      performer.clearedLevels.push(lvl);
    }

    console.log(`[xp] ${performer.name} +${xpEarned}xp +${coinsEarned}coins (level ${lvl})`);
    cb && cb({ ok: true, xpEarned, coinsEarned });

    // Auto-advance after brief reward pause
    setTimeout(() => {
      if (!rooms[room.code] || room.phase !== 'game') return;
      advanceTurn(room);
    }, 1500);
  });

  // Park a dare — consumes a break slot, no XP awarded
  socket.on('use-break-slot', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    const performer = room.players[socket.id];
    if (!performer) return cb && cb({ ok: false });

    const turn = room.currentTurn;
    if (!turn || turn.phase !== 'showing' || turn.choice !== 'dare') {
      return cb && cb({ ok: false, error: 'Can only park dares' });
    }
    if (turn.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });

    const card = turn.card;
    if (!card) return cb && cb({ ok: false });

    if (performer.breakSlots.used >= performer.breakSlots.total) {
      // All slots full — loss condition
      room.currentTurn.phase = 'loss';
      io.to(code).emit('room-state', roomPublicState(room));
      return cb && cb({ ok: false, error: 'No break slots remaining — you lose!' });
    }

    performer.breakSlots.used++;
    performer.breakSlots.parkedDares.push({
      cardId: card.id,
      level: card.level,
      difficulty: card.difficulty || 1,
      text: card.text,
      xpPenalty: card.level * (card.difficulty || 1),
    });

    const slotsRemaining = performer.breakSlots.total - performer.breakSlots.used;
    cb && cb({ ok: true, slotsRemaining });
    advanceTurn(room);
  });

  // Replay a previously parked dare (on own turn, choosing phase)
  socket.on('replay-parked-dare', ({ code, cardId }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });
    const performer = room.players[socket.id];
    if (!performer) return cb && cb({ ok: false });

    if (room.currentTurn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
    if (room.currentTurn?.phase !== 'choosing') return cb && cb({ ok: false, error: 'Wrong phase' });

    const parkedIdx = performer.breakSlots.parkedDares.findIndex(d => d.cardId === cardId);
    if (parkedIdx === -1) return cb && cb({ ok: false, error: 'Parked dare not found' });

    const parked = performer.breakSlots.parkedDares.splice(parkedIdx, 1)[0];
    performer.breakSlots.used = Math.max(0, performer.breakSlots.used - 1);

    // Reconstruct card from room pool (for full card object)
    const card = getRoomCards(room).find(c => c.id === parked.cardId) || {
      id: parked.cardId, type: 'dare', level: parked.level,
      difficulty: parked.difficulty, text: parked.text, tags: [],
    };

    room.currentTurn.choice          = 'dare';
    room.currentTurn.card            = card;
    room.currentTurn.phase           = 'showing';
    room.currentTurn.recycled        = false;
    room.currentTurn.softFlagged     = false;
    room.currentTurn.rouletteUpgrade = false;
    room.currentTurn.attribution     = { type: 'solo', performerId: socket.id };

    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Respin for soft-flagged card — draw from level+1 (capped at unlocked max)
  socket.on('respin-card', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });
    if (room.currentTurn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
    if (room.currentTurn?.phase !== 'showing') return cb && cb({ ok: false, error: 'Wrong phase' });

    const performer = room.players[socket.id];
    const target = room.currentTurn.targetId !== socket.id
      ? room.players[room.currentTurn.targetId]
      : null;
    const choice = room.currentTurn.choice;

    const currentLevel = performer.currentLevel || 1;
    const maxLevel = maxUnlockedLevel(performer);
    // Try level+1, capped at maxLevel; if already at max, stay at same level
    const respinLevel = Math.min(currentLevel + 1, maxLevel);

    const { card, recycled, softFlagged } = selectCard(
      getRoomCards(room), choice, performer, target, respinLevel,
      performer.usedCardIds,
      { rouletteMode: 'off' }
    );

    if (card) performer.usedCardIds.add(card.id);

    room.currentTurn.card        = card;
    room.currentTurn.recycled    = recycled;
    room.currentTurn.softFlagged = softFlagged;
    room.currentTurn.rouletteUpgrade = false;

    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // End the game — apply XP penalties for parked dares
  socket.on('end-game', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Only host can end game' });

    // Apply XP penalties for all still-parked dares
    for (const player of Object.values(room.players)) {
      const penalty = player.breakSlots.parkedDares.reduce((sum, d) => sum + d.xpPenalty, 0);
      player.xp = Math.max(0, player.xp - penalty);
      player.breakSlots.parkedDares = [];
    }

    room.phase = 'ended';
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Restart game — keep identity, reset progression
  socket.on('restart-game', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Only host can restart' });

    for (const player of Object.values(room.players)) {
      player.xp = 0;
      player.coins = 0;
      player.currentLevel = 1;
      player.clearedLevels = [];
      player.daresCompletedPerLevel = {};
      player.usedCardIds = new Set();
      player.breakSlots = { total: 3, used: 0, parkedDares: [] };
      player.immunity = 0;
      player.activePowerups = [];
      player.ready = false;
    }

    room.phase = 'lobby';
    room.turnOrder = [];
    room.currentTurnIndex = -1;
    room.currentTurn = null;

    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // ─── Duel resolution (host-only) ─────────────────────────────────────────────
  socket.on('resolve-duel', ({ code, winnerId }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    if (room.host !== socket.id && room.displayHostId !== socket.id) {
      return cb && cb({ ok: false, error: 'Host only' });
    }
    if (room.phase !== 'game') return cb && cb({ ok: false, error: 'Not in game' });
    if (room.currentTurn?.phase !== 'duel') return cb && cb({ ok: false, error: 'Not in duel phase' });

    const turn = room.currentTurn;
    // Prevent a participant from resolving their own duel
    if (socket.id === turn.performerId || socket.id === turn.targetId) {
      return cb && cb({ ok: false, error: 'Duel participants cannot resolve the duel' });
    }
    const actualWinnerId = turn.duelAutoWinnerId || winnerId;
    const performerId    = turn.attribution?.performerId || turn.performerId;
    const targetId       = turn.attribution?.targetId    || turn.targetId;
    const loserId        = actualWinnerId === performerId ? targetId : performerId;

    const performer = room.players[performerId];
    const winner    = room.players[actualWinnerId];

    // XP always goes to performer (turn-holder), coins to winner
    const { xpEarned, coinRecipients } = calcRewards(
      turn.card,
      { type: 'duel', winnerId: actualWinnerId },
      room.economyMode,
      turn.doubleXp || false
    );

    if (performer) performer.xp += xpEarned;
    for (const { id, coins } of coinRecipients) {
      if (room.players[id]) room.players[id].coins += coins;
    }

    // Track level clearing for performer
    if (performer) {
      const lvl = turn.card.level;
      performer.daresCompletedPerLevel[lvl] = (performer.daresCompletedPerLevel[lvl] || 0) + 1;
      if (performer.daresCompletedPerLevel[lvl] >= 3 && !performer.clearedLevels.includes(lvl)) {
        performer.clearedLevels.push(lvl);
      }
    }

    const winnerName = winner?.name || 'Someone';
    io.to(code).emit('toast', { msg: `🏆 ${winnerName} won the duel!` });

    // Pick a small forfeit dare for the loser
    const loser = room.players[loserId];
    let forfeitCard = null;
    if (loser) {
      const forfeitLevel = Math.max(1, Math.min(3, Math.ceil(turn.card.level / 3)));
      const fr = selectCard(getRoomCards(room), 'dare', loser, null, forfeitLevel, loser.usedCardIds, { rouletteMode: 'off' });
      if (fr.card && fr.card.type === 'dare') {
        forfeitCard = fr.card;
        loser.usedCardIds.add(forfeitCard.id);
      }
    }

    if (forfeitCard && loser) {
      turn.phase  = 'duel-forfeit';
      turn.forfeit = { playerId: loserId, card: forfeitCard };
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
    } else {
      turn.phase = 'showing'; // brief resolved state before advance
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
      setTimeout(() => {
        if (!rooms[room.code] || room.phase !== 'game') return;
        advanceTurn(room);
      }, 1500);
    }
  });

  // Loser (or host) confirms forfeit dare is done — advance turn
  socket.on('complete-forfeit', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });
    if (room.currentTurn?.phase !== 'duel-forfeit') return cb && cb({ ok: false, error: 'Not in forfeit phase' });

    const forfeit = room.currentTurn.forfeit;
    if (!forfeit) return cb && cb({ ok: false });

    const isLoser   = socket.id === forfeit.playerId;
    const isHost    = socket.id === room.host || socket.id === room.displayHostId;
    if (!isLoser && !isHost) return cb && cb({ ok: false, error: 'Not authorized' });

    cb && cb({ ok: true });
    setTimeout(() => {
      if (!rooms[room.code] || room.phase !== 'game') return;
      advanceTurn(room);
    }, 1500);
  });

  // ─── Power-up shop ────────────────────────────────────────────────────────────
  socket.on('buy-powerup', ({ code, powerupId }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false });
    if (room.phase !== 'game') return cb && cb({ ok: false, error: 'Game not in progress' });

    const player = room.players[socket.id];
    if (!player) return cb && cb({ ok: false });

    const cost = POWERUP_COSTS[powerupId];
    if (!cost) return cb && cb({ ok: false, error: 'Unknown powerup' });
    if (!(room.enabledPowerups || []).includes(powerupId)) {
      return cb && cb({ ok: false, error: 'Powerup not enabled' });
    }
    if (player.coins < cost) return cb && cb({ ok: false, error: 'Not enough coins' });

    player.coins -= cost;
    player.activePowerups.push(powerupId);
    cb && cb({ ok: true, coins: player.coins });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  socket.on('use-powerup', ({ code, powerupId, targetId: puTargetId }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });

    const player = room.players[socket.id];
    if (!player) return cb && cb({ ok: false });

    const idx = player.activePowerups.indexOf(powerupId);
    if (idx === -1) return cb && cb({ ok: false, error: 'Powerup not in inventory' });

    const turn = room.currentTurn;

    // Per-powerup validation and effect
    if (powerupId === 'skip') {
      if (turn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
      if (turn?.phase !== 'showing') return cb && cb({ ok: false, error: 'Can only skip on card screen' });
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true });
      advanceTurn(room);
      return;
    }

    if (powerupId === 'immunity_stone') {
      player.immunity = Math.min(1, player.immunity + 0.02);
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true, immunity: player.immunity });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    if (powerupId === 'force_swap') {
      if (turn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
      if (!turn?.targetId) return cb && cb({ ok: false, error: 'No current target' });
      const newTarget = pickTarget(room, socket.id, turn.targetId);
      if (!newTarget || newTarget === turn.targetId) return cb && cb({ ok: false, error: 'No alternative target available' });
      turn.targetId = newTarget;
      if (turn.attribution) turn.attribution.targetId = newTarget;
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    if (powerupId === 'double_xp') {
      if (turn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
      turn.doubleXp = true;
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    if (powerupId === 'insight') {
      if (turn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
      if (turn?.phase !== 'choosing') return cb && cb({ ok: false, error: 'Insight only works during choosing phase' });
      // Trial draw to reveal dare type
      const trialTarget = (turn.targetId && turn.targetId !== socket.id) ? room.players[turn.targetId] : null;
      const trialDuel = (trialTarget && Math.random() < 0.25)
        ? selectCard(getRoomCards(room), 'duel', player, trialTarget, player.currentLevel || 1, player.usedCardIds, { rouletteMode: 'off' })
        : { card: null };
      if (trialDuel.card) {
        turn.insightType = 'duel';
      } else {
        const trialDare = selectCard(getRoomCards(room), 'dare', player, trialTarget, player.currentLevel || 1, player.usedCardIds, { rouletteMode: 'off' });
        turn.insightType = trialDare.card ? 'dare' : 'truth';
      }
      turn.insightRevealed = true;
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true, insightType: turn.insightType });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    if (powerupId === 'sabotage') {
      const target = room.players[puTargetId];
      if (!target) return cb && cb({ ok: false, error: 'Target not found' });
      if (puTargetId === socket.id) return cb && cb({ ok: false, error: 'Cannot sabotage yourself' });
      target.immunity = Math.max(0, target.immunity - 0.05);
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    if (powerupId === 'auto_win_duel') {
      if (turn?.performerId !== socket.id) return cb && cb({ ok: false, error: 'Not your turn' });
      if (turn?.phase !== 'duel') {
        return cb && cb({ ok: false, error: 'Auto-win only usable during a duel' });
      }
      turn.duelAutoWinnerId = socket.id;
      player.activePowerups.splice(idx, 1);
      cb && cb({ ok: true });
      io.to(code).emit('room-state', roomPublicState(room));
      return;
    }

    cb && cb({ ok: false, error: 'Unhandled powerup' });
  });

  // Emergency host-only turn advance (stuck state recovery)
  socket.on('next-turn', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room) return;
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Host only' });
    advanceTurn(room);
    cb && cb({ ok: true });
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;

    const wasPerformer = room.phase === 'game' && room.currentTurn?.performerId === socket.id;

    if (room.players[socket.id]) {
      delete room.players[socket.id];
      room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
    }

    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      console.log(`[room] ${code} closed (empty)`);
      return;
    }

    // Reassign host if player-host disconnected (not display host)
    if (room.host === socket.id && room.hostMode !== 'display') {
      room.host = Object.keys(room.players)[0] || socket.id;
    }

    if (wasPerformer && room.phase === 'game' && room.turnOrder.length > 0) {
      advanceTurn(room); // skip disconnected performer's turn
    } else {
      io.to(code).emit('room-state', roomPublicState(room));
    }

    console.log(`[disconnect] ${socket.id} from ${code}`);
  });
});

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/cards',  (req, res) => res.json(ALL_CARDS));
app.get('/editor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'editor.html')));

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
