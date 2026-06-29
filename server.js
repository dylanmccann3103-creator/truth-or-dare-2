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
const {
  coinsByEconomy, calcRewards, applyImmunity, POWERUP_COSTS,
  BASE_GENDERS, mergeGenders, clothingCategory,
  isClothingRemovalCard, clothingTokenKind, stillOnItems, autoPickableItems,
  pickClothingItem, renderTokens, selectTarget,
} = require('./lib/gameHelpers');

function getRoomCards(room) {
  const cards = room.cardPool || ALL_CARDS;
  if (!room.equipmentLimits || room.equipmentLimits.length === 0) return cards;
  return cards.filter(c => !c.tags || !c.tags.some(t => room.equipmentLimits.includes(t)));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || null;

if (!BASE_URL) {
  console.warn('[warn] BASE_URL not set — QR codes will use local IP (fine for LAN, wrong on Railway)');
}

const ALL_TAGS = ['general','flirty','clothing','body','physical','feet','kissing','speaking','oral','intimate','explicit','anal','bondage','toy','public','exposure'];
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
    minLevel: 1,                     // lowest level players may choose
    maxLevel: 10,                    // highest level players may choose
    levelMode: 'locked',             // 'locked' = earn access; 'free' = all open from start
    rouletteMode: 'off',             // 'off' | 'plus1' | 'block'
    targetingMode: '50-50',         // 'self' | '50-50' | 'random'
    economyMode: 'schaars',         // 'schaars' | 'gemiddeld' | 'overvloedig'
    enabledPowerups: [],
    activeEvent: null,
    cardPool: null,          // null = use ALL_CARDS; set from host's active packages
    equipmentLimits: [],     // equip_* tags for unavailable equipment — filtered from card pool
    knownGenders: BASE_GENDERS.map(g => ({ ...g })), // base + merged pack genders
    backgroundActivities: [],          // active background dares (continue-dare)
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code]; }

// Normalise incoming clothing items: add removed:false + a mapped category to each.
function normalizeClothing(clothing) {
  if (!Array.isArray(clothing)) return [];
  return clothing
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      key: c.key,
      label: c.label,
      value: c.value,
      removed: false,
      category: clothingCategory(c),
    }));
}

// Connected players (excluding `performerId`) eligible to be drawn as a target.
function connectedCandidates(room, performerId) {
  return room.turnOrder
    .filter(id => id !== performerId && room.players[id] && room.players[id].connected !== false)
    .map(id => room.players[id]);
}

// Mark a player's clothing item removed (idempotent — never removes twice).
function markClothingRemoved(player, itemKey) {
  if (!player || !Array.isArray(player.clothingItems)) return false;
  const item = player.clothingItems.find(c => c.key === itemKey && !c.removed);
  if (!item) return false;
  item.removed = true;
  return true;
}

/**
 * Resolve a freshly-selected card onto the current turn: draw the target (PB) for
 * targetRequired cards, auto-pick clothing for {{c}}/{{ct}} cards, and render all
 * tokens into a served copy of the card. Mutates `turn` only (never the shared card
 * object or — for auto-pick — the wardrobe, which is consumed on completion).
 */
function prepareServedCard(room, turn, performer, sel) {
  const card = sel.card;
  // Reset per-turn clothing bookkeeping.
  turn.clothingMode = null;       // 'auto' | 'choice' | null
  turn.clothingOwner = null;      // 'performer' | 'target'
  turn.clothingPick = null;       // { key } for auto cards
  turn.clothingEligibleKeys = []; // keys offered for player-choice cards

  // 1) Target draw (only for targetRequired cards with valid candidates).
  let target = null;
  if (card.targetRequired) {
    target = selectTarget(sel.validTargets || [], card);
    turn.targetId = target ? target.id : null;
    turn.validTargetIds = (sel.validTargets || []).map(t => t.id);
  } else {
    turn.targetId = null;
    turn.validTargetIds = [];
  }

  // 2) Clothing resolution.
  let cLabel = null, ctLabel = null;
  if (isClothingRemovalCard(card)) {
    const kind = clothingTokenKind(card);             // 'c' | 'ct' | null
    const owner = (kind === 'ct') ? target : performer;
    turn.clothingOwner = (kind === 'ct') ? 'target' : 'performer';
    if (owner) {
      if (kind === 'c' || kind === 'ct') {
        // Auto-pick: weighted pick now (no underwear below level 6), consume on completion.
        const pick = pickClothingItem(autoPickableItems(owner.clothingItems, card.level));
        if (pick) {
          turn.clothingMode = 'auto';
          turn.clothingPick = { key: pick.key };
          if (kind === 'ct') ctLabel = pick.value; else cLabel = pick.value;
        }
      } else {
        // Player-choice: offer every still-on item (player may take off anything).
        turn.clothingMode = 'choice';
        turn.clothingEligibleKeys = stillOnItems(owner.clothingItems).map(it => it.key);
      }
    }
  }

  // 3) Token render into a served copy ({{PB}}/{{ct}} only valid on target cards).
  const subs = { paName: performer.name };
  if (card.targetRequired && target) subs.pbName = target.name;
  if (cLabel != null) subs.cLabel = cLabel;
  if (ctLabel != null) subs.ctLabel = ctLabel;
  return { ...card, text: renderTokens(card.text, subs) };
}

/**
 * On dare completion: consume the clothing pick (auto cards) and advance the strip
 * streak. A completed strip card bumps the stripper's streak (2-in-a-row triggers the
 * "next draw must be non-clothing" guardrail in selectCard); any non-strip completion
 * resets the active performer's streak.
 */
function applyClothingCompletion(room, turn, performer) {
  const card = turn && turn.card;
  if (!card || !isClothingRemovalCard(card)) {
    if (performer) performer.clothingStreak = 0; // non-strip turn resets the streak
    return;
  }
  const owner = turn.clothingOwner === 'target' ? room.players[turn.targetId] : performer;
  if (turn.clothingMode === 'auto' && turn.clothingPick && owner) {
    markClothingRemoved(owner, turn.clothingPick.key);
  }
  // (player-choice removals already applied via the 'remove-clothing' event)
  if (owner) owner.clothingStreak = (owner.clothingStreak || 0) + 1;
  // If the performer wasn't the one who stripped ({{ct}} card), reset their streak.
  if (owner !== performer && performer) performer.clothingStreak = 0;
}

function generateToken() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

// ─── Progression helpers ──────────────────────────────────────────────────────

function canAccessLevel(player, level, room) {
  const maxLvl = room?.maxLevel ?? 10;
  if (level > maxLvl) return false;
  if (level <= (room?.minLevel ?? 1)) return true;
  if (room?.levelMode === 'free') return true;
  if (level <= 1) return true;
  const prev = level - 1;
  const xpThreshold = 3 * level * (level - 1);
  return player.xp >= xpThreshold && player.clearedLevels.includes(prev);
}

function maxUnlockedLevel(player, room) {
  const max = room?.maxLevel ?? 10;
  for (let lvl = max; lvl >= 1; lvl--) {
    if (canAccessLevel(player, lvl, room)) return lvl;
  }
  return room?.minLevel ?? 1;
}

// ─── Game helpers ─────────────────────────────────────────────────────────────

function pickTarget(room, performerId, excludeId = null) {
  let others = room.turnOrder.filter(id => id !== performerId && room.players[id] && room.players[id].connected !== false && !room.players[id].occupied);
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
    // Safety: if all players are disconnected, wait — don't spin forever
    const connectedPlayers = room.turnOrder.filter(id => room.players[id] && room.players[id].connected !== false && !room.players[id].occupied);
    if (connectedPlayers.length === 0) {
      // All remaining players are occupied — park and wait for one to finish
      room.currentTurn = { ...room.currentTurn, phase: 'waiting-for-occupied' };
      io.to(room.code).emit('room-state', roomPublicState(room));
      return;
    }
    const performerId = room.turnOrder[room.currentTurnIndex % room.turnOrder.length];
    if (!room.players[performerId] || room.players[performerId].connected === false || room.players[performerId].occupied) {
      // Player gone, disconnected, or occupied — skip ahead
      advanceTurn(room);
      return;
    }
    // Target (PB) is drawn AFTER card selection — not here. Choosing phase has no target.
    room.currentTurn = {
      targetId: null, performerId,
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
      genitals: p.genitals || [],
      orientation: p.orientation,
      availableForAllCombos: p.availableForAllCombos,
      connected: p.connected !== false,
      occupied: p.occupied || false,
      backgroundDare: p.backgroundDare ? {
        cardId: p.backgroundDare.card?.id,
        text: p.backgroundDare.card?.text,
        level: p.backgroundDare.card?.level,
        targetId: p.backgroundDare.targetId || null,
        activityId: p.backgroundDare.activityId,
      } : null,
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
    minLevel: room.minLevel ?? 1,
    maxLevel: room.maxLevel ?? 10,
    levelMode: room.levelMode ?? 'locked',
    minStartLevel: room.minStartLevel,
    enabledPowerups: room.enabledPowerups || [],
    knownGenders: room.knownGenders || [],
    backgroundActivities: (room.backgroundActivities || []).map(a => ({
      id: a.id,
      performerId: a.performerId,
      targetId: a.targetId || null,
      cardText: a.card?.text,
      cardLevel: a.card?.level,
      cardType: a.card?.type,
    })),
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

  // Player submits setup (name, clothingItems, prefs, limits, softLimits, gender, genitals, orientation, language)
  socket.on('player-setup', ({ code, name, emoji, clothing, preferences, limits, limits_soft, gender, genitals, orientation, availableForAllCombos, language }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const token = generateToken();
    const emojiIdx = Object.keys(room.players).length % EMOJIS.length;
    const chosenEmoji = (emoji && EMOJIS.includes(emoji)) ? emoji : EMOJIS[emojiIdx];
    room.players[socket.id] = {
      id: socket.id,
      token,
      name,
      emoji: chosenEmoji,
      clothingItems: normalizeClothing(clothing),
      clothingStreak: 0,              // consecutive completed strip cards (pacing guardrail)
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
      occupied: false,
      backgroundDare: null,
      immunity: 0,
      activePowerups: [],
      gender: gender || null,
      genitals: Array.isArray(genitals) ? genitals : [],
      orientation: orientation || 'bi',
      availableForAllCombos: availableForAllCombos || false,
      language: language || 'nl',
      connected: true,
    };
    socket.data.roomCode = code;
    cb({ ok: true, token });
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

  // Host sets available equipment (before QR lobby, lobby phase only)
  socket.on('set-equipment', ({ code, limits }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Host only' });
    if (room.phase !== 'lobby') return cb && cb({ ok: false, error: 'Lobby only' });
    room.equipmentLimits = Array.isArray(limits) ? limits.filter(t => typeof t === 'string') : [];
    cb && cb({ ok: true });
  });

  // Host updates game config (lobby phase only)
  socket.on('set-game-config', ({ code, targetingMode, rouletteMode, economyMode, enabledPowerups, minLevel, maxLevel, levelMode }, cb) => {
    const room = getRoom(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Only the host can configure' });
    if (room.phase !== 'lobby') return cb && cb({ ok: false, error: 'Can only configure in lobby' });

    const validTargeting  = ['self', '50-50', 'random'];
    const validRoulette   = ['off', 'plus1', 'block'];
    const validEconomy    = ['schaars', 'gemiddeld', 'overvloedig'];
    const validLevelModes = ['locked', 'free'];
    const validPowerups   = Object.keys(POWERUP_COSTS);

    if (targetingMode && validTargeting.includes(targetingMode))   room.targetingMode = targetingMode;
    if (rouletteMode  && validRoulette.includes(rouletteMode))     room.rouletteMode  = rouletteMode;
    if (economyMode   && validEconomy.includes(economyMode))       room.economyMode   = economyMode;
    if (levelMode     && validLevelModes.includes(levelMode))      room.levelMode     = levelMode;
    if (minLevel !== undefined) {
      const n = parseInt(minLevel, 10);
      if (n >= 1 && n <= 9) room.minLevel = n;
    }
    if (maxLevel !== undefined) {
      const n = parseInt(maxLevel, 10);
      if (n >= 2 && n <= 10 && n > room.minLevel) room.maxLevel = n;
    }
    if (Array.isArray(enabledPowerups)) {
      room.enabledPowerups = enabledPowerups.filter(p => validPowerups.includes(p));
    }

    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
  });

  // Host starts the game
  socket.on('start-game', ({ code, cardPool, genders }, cb) => {
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

    // Merge any pack-declared custom genders into the known list (data-driven gender).
    if (Array.isArray(genders) && genders.length > 0) {
      room.knownGenders = mergeGenders(room.knownGenders, genders);
    }

    room.phase = 'game';
    room.turnOrder = playerIds.sort(() => Math.random() - 0.5);
    room.currentTurnIndex = -1;
    room.currentTurn = null;
    // Apply minLevel: everyone starts at the configured floor
    const startLevel = room.minLevel ?? 1;
    if (startLevel > 1) {
      playerIds.forEach(id => {
        const p = room.players[id];
        p.currentLevel = startLevel;
        // In free mode we don't need progression tracking; in locked mode pre-clear all prior levels
        if (room.levelMode === 'locked') {
          for (let l = 1; l < startLevel; l++) {
            if (!p.clearedLevels.includes(l)) p.clearedLevels.push(l);
          }
        }
      });
    }
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
    if (!canAccessLevel(player, lvl, room)) {
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
      if (bumped < 10 && canAccessLevel(performer, bumped, room)) {
        effectiveLevel = bumped;
        rouletteUpgrade = true;
      }
    }

    const scMode = room.rouletteMode === 'block' ? 'block' : 'off';

    // targetingMode decides self vs. other; the actual PB is drawn AFTER card selection
    // (only for the 'other' branch). We pass selectCard ALL valid candidates so it only
    // serves a target-required card when at least one candidate passes the target checks.
    const candidates = connectedCandidates(room, socket.id);
    let allowOther;
    if (room.targetingMode === 'self')        allowOther = false;
    else if (room.targetingMode === 'random') allowOther = true;
    else                                       allowOther = Math.random() < 0.5; // 50-50
    const candidatePool = (allowOther && candidates.length > 0) ? candidates : [];

    // Duel roll: 25% chance when choice is 'dare' and an opponent is available
    if (choice === 'dare' && candidatePool.length > 0 && Math.random() < 0.25) {
      const duelResult = selectCard(
        getRoomCards(room), 'duel', performer, candidatePool, effectiveLevel,
        performer.usedCardIds, { rouletteMode: scMode }
      );
      if (duelResult.card) {
        performer.usedCardIds.add(duelResult.card.id);
        const served = prepareServedCard(room, room.currentTurn, performer, duelResult);
        room.currentTurn.choice          = 'dare';
        room.currentTurn.card            = served;
        room.currentTurn.phase           = 'duel';
        room.currentTurn.recycled        = duelResult.recycled;
        room.currentTurn.softFlagged     = false;
        room.currentTurn.rouletteUpgrade = rouletteUpgrade;
        room.currentTurn.attribution     = { type: 'duel', performerId: socket.id, targetId: room.currentTurn.targetId };
        room.currentTurn.duelAutoWinnerId = null;
        cb && cb({ ok: true, isDuel: true });
        io.to(code).emit('room-state', roomPublicState(room));
        return;
      }
    }

    const sel = selectCard(
      getRoomCards(room), choice, performer, candidatePool, effectiveLevel,
      performer.usedCardIds, { rouletteMode: scMode }
    );

    if (sel.card) performer.usedCardIds.add(sel.card.id);

    const served = sel.card ? prepareServedCard(room, room.currentTurn, performer, sel) : null;

    room.currentTurn.choice          = choice;
    room.currentTurn.card            = served;
    room.currentTurn.phase           = 'showing';
    room.currentTurn.recycled        = sel.recycled;
    room.currentTurn.softFlagged     = sel.softFlagged;
    room.currentTurn.rouletteUpgrade = rouletteUpgrade;
    room.currentTurn.attribution     = { type: 'solo', performerId: socket.id };

    cb && cb({ ok: true, recycled: sel.recycled, softFlagged: sel.softFlagged, rouletteUpgrade });
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

    // Clothing removal + strip-streak pacing — consumed on COMPLETION only.
    applyClothingCompletion(room, room.currentTurn, performer);

    console.log(`[xp] ${performer.name} +${xpEarned}xp +${coinsEarned}coins (level ${lvl})`);
    cb && cb({ ok: true, xpEarned, coinsEarned });

    // Auto-advance after brief reward pause
    setTimeout(() => {
      if (!rooms[room.code] || room.phase !== 'game') return;
      advanceTurn(room);
    }, 1500);
  });

  // Player-choice clothing removal: the performer (or, for {{ct}} cards, the target
  // actor) removes a still-on garment. Never removes an already-removed item twice.
  socket.on('remove-clothing', ({ code, itemKey }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });
    const turn = room.currentTurn;
    if (!turn || turn.phase !== 'showing') return cb && cb({ ok: false, error: 'Wrong phase' });
    if (!isClothingRemovalCard(turn.card)) return cb && cb({ ok: false, error: 'Not a clothing card' });

    // Owner is whose wardrobe loses the item (performer for {{c}}/player-choice, target for {{ct}}).
    const ownerId = turn.clothingOwner === 'target' ? turn.targetId : turn.performerId;
    const owner   = room.players[ownerId];
    // Only the performer or the drawn target (the actor) may trigger the removal.
    if (socket.id !== turn.performerId && socket.id !== turn.targetId) {
      return cb && cb({ ok: false, error: 'Not part of this card' });
    }
    if (!owner) return cb && cb({ ok: false, error: 'No clothing owner' });
    if (!markClothingRemoved(owner, itemKey)) {
      return cb && cb({ ok: false, error: 'Item not available' });
    }
    cb && cb({ ok: true });
    io.to(code).emit('room-state', roomPublicState(room));
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
    const choice = room.currentTurn.choice;
    const candidatePool = connectedCandidates(room, socket.id);

    const currentLevel = performer.currentLevel || 1;
    const maxLevel = maxUnlockedLevel(performer, room);
    // Try level+1, capped at maxLevel; if already at max, stay at same level
    const respinLevel = Math.min(currentLevel + 1, maxLevel);

    const sel = selectCard(
      getRoomCards(room), choice, performer, candidatePool, respinLevel,
      performer.usedCardIds,
      { rouletteMode: 'off' }
    );

    if (sel.card) performer.usedCardIds.add(sel.card.id);

    room.currentTurn.card        = sel.card ? prepareServedCard(room, room.currentTurn, performer, sel) : null;
    room.currentTurn.recycled    = sel.recycled;
    room.currentTurn.softFlagged = sel.softFlagged;
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

    room.backgroundActivities = [];

    for (const player of Object.values(room.players)) {
      player.xp = 0;
      player.coins = 0;
      player.currentLevel = 1;
      player.clearedLevels = [];
      player.daresCompletedPerLevel = {};
      player.usedCardIds = new Set();
      player.breakSlots = { total: 3, used: 0, parkedDares: [] };
      player.occupied = false;
      player.backgroundDare = null;
      player.immunity = 0;
      player.activePowerups = [];
      player.ready = false;
      player.clothingStreak = 0;
      // Restore wardrobe (setup is kept, but removed garments come back for a fresh game).
      if (Array.isArray(player.clothingItems)) player.clothingItems.forEach(c => { c.removed = false; });
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
      // Swap only to another VALID target for this card (limits/orientation/genitals safe).
      const alternatives = (turn.validTargetIds || [])
        .filter(id => id !== turn.targetId && room.players[id] && room.players[id].connected !== false);
      if (alternatives.length === 0) return cb && cb({ ok: false, error: 'No alternative target available' });
      const newTarget = alternatives[Math.floor(Math.random() * alternatives.length)];
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

  // Continue: move dare to background, game advances with remaining players
  socket.on('continue-dare', ({ code }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });
    const turn = room.currentTurn;
    if (!turn || turn.phase !== 'showing') return cb && cb({ ok: false, error: 'Wrong phase' });

    if (room.host !== socket.id) return cb && cb({ ok: false, error: 'Host only' });

    const performer = room.players[turn.performerId];
    if (!performer) return cb && cb({ ok: false });

    const activityId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const activity = {
      id: activityId,
      performerId: turn.performerId,
      targetId: turn.targetId || null,
      card: turn.card,
      attribution: turn.attribution,
      doubleXp: turn.doubleXp || false,
    };
    room.backgroundActivities.push(activity);

    performer.occupied = true;
    performer.backgroundDare = { card: turn.card, targetId: turn.targetId || null, activityId };

    // Mark target occupied too for duo/target-required cards
    if (turn.targetId && room.players[turn.targetId] && turn.card?.targetRequired) {
      const target = room.players[turn.targetId];
      target.occupied = true;
      target.backgroundDare = { card: turn.card, targetId: turn.targetId, activityId };
    }

    cb && cb({ ok: true, activityId });
    advanceTurn(room);
  });

  // Complete a background dare — awards XP/coins and frees the occupied player(s)
  socket.on('complete-background-dare', ({ code, activityId }, cb) => {
    const room = getRoom(code);
    if (!room || room.phase !== 'game') return cb && cb({ ok: false });

    const idx = (room.backgroundActivities || []).findIndex(a => a.id === activityId);
    if (idx === -1) return cb && cb({ ok: false, error: 'Activity not found' });

    const activity = room.backgroundActivities[idx];
    // Only the performer (or display host) can mark it done
    const isPerformer = socket.id === activity.performerId;
    const isDisplayHost = room.hostMode === 'display' && socket.id === room.host;
    if (!isPerformer && !isDisplayHost) return cb && cb({ ok: false, error: 'Not authorized' });

    const performer = room.players[activity.performerId];
    if (performer) {
      const { xpEarned, coinRecipients } = calcRewards(
        activity.card, activity.attribution, room.economyMode, activity.doubleXp
      );
      performer.xp += xpEarned;
      for (const { id, coins } of coinRecipients) {
        if (room.players[id]) room.players[id].coins += coins;
      }
      const lvl = activity.card.level;
      performer.daresCompletedPerLevel[lvl] = (performer.daresCompletedPerLevel[lvl] || 0) + 1;
      if (performer.daresCompletedPerLevel[lvl] >= 3 && !performer.clearedLevels.includes(lvl)) {
        performer.clearedLevels.push(lvl);
      }
      performer.occupied = false;
      performer.backgroundDare = null;
      cb && cb({ ok: true, xpEarned });
    }

    // Free target if they were co-occupied
    if (activity.targetId && room.players[activity.targetId]) {
      const target = room.players[activity.targetId];
      if (target.backgroundDare?.activityId === activityId) {
        target.occupied = false;
        target.backgroundDare = null;
      }
    }

    room.backgroundActivities.splice(idx, 1);

    // If the game was waiting for an occupied player to free up, resume now
    const wasWaiting = room.currentTurn?.phase === 'waiting-for-occupied';
    io.to(room.code).emit('room-state', roomPublicState(room));
    if (wasWaiting) {
      advanceTurn(room);
    }
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

    const player = room.players[socket.id];
    const wasPerformer = room.phase === 'game' && room.currentTurn?.performerId === socket.id;

    if (player) {
      if (room.phase === 'game') {
        // In-game: keep player state for potential rejoin, just mark disconnected
        player.connected = false;
        console.log(`[disconnect] ${socket.id} (${player.name}) marked disconnected in ${code}`);
      } else {
        // In lobby: remove entirely (no game state to preserve)
        delete room.players[socket.id];
        room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
        console.log(`[disconnect] ${socket.id} removed from lobby ${code}`);
      }
    }

    const activePlayers = Object.values(room.players).filter(p => p.connected !== false);
    if (activePlayers.length === 0 && room.phase !== 'game') {
      delete rooms[code];
      console.log(`[room] ${code} closed (empty)`);
      return;
    }

    // Reassign host if player-host disconnected (not display host)
    if (room.host === socket.id && room.hostMode !== 'display') {
      const nextHost = Object.keys(room.players).find(id => room.players[id].connected !== false);
      if (nextHost) room.host = nextHost;
    }

    if (wasPerformer && room.phase === 'game') {
      advanceTurn(room); // skip disconnected performer's turn
    } else {
      io.to(code).emit('room-state', roomPublicState(room));
    }
  });

  // Rejoin a room using a saved token
  socket.on('rejoin-room', ({ code, token }, cb) => {
    const room = getRoom(code);
    if (!room) return cb({ ok: false, error: 'Room not found' });

    // Find the player by token
    const oldId = Object.keys(room.players).find(id => room.players[id].token === token);
    if (!oldId) return cb({ ok: false, error: 'Session not found — game may have ended' });

    const player = room.players[oldId];

    if (oldId !== socket.id) {
      // Re-key the player entry under the new socket id
      room.players[socket.id] = { ...player, id: socket.id, connected: true };
      delete room.players[oldId];

      // Update turnOrder reference
      const idx = room.turnOrder.indexOf(oldId);
      if (idx !== -1) room.turnOrder[idx] = socket.id;

      // Update currentTurn references
      if (room.currentTurn) {
        if (room.currentTurn.performerId === oldId) room.currentTurn.performerId = socket.id;
        if (room.currentTurn.targetId    === oldId) room.currentTurn.targetId    = socket.id;
      }

      // Update host reference if this was the host
      if (room.host === oldId) room.host = socket.id;
    } else {
      // Same socket reconnecting (unlikely but safe)
      player.connected = true;
    }

    socket.join(code);
    socket.data.roomCode = code;

    console.log(`[rejoin] ${socket.id} rejoined ${code} as ${player.name}`);
    cb({ ok: true, name: room.players[socket.id].name });
    io.to(code).emit('room-state', roomPublicState(room));
  });
});

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/cards',  (req, res) => res.json(ALL_CARDS));

// Serve HTML files with no-cache so deploys are picked up immediately
function sendNoCache(file) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, 'public', file));
  };
}
app.get('/',        sendNoCache('index.html'));
app.get('/editor',  sendNoCache('editor.html'));
app.get('/host',    sendNoCache('host.html'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tags', (req, res) => {
  const tags = new Set();
  ALL_CARDS.forEach(c => (c.tags || []).forEach(t => tags.add(t)));
  res.json({ tags: [...tags].sort() });
});

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

// ─── Language packs ────────────────────────────────────────────────────────────
const fs = require('fs');
const LANG_DIR = path.join(__dirname, 'data', 'lang');
app.get('/lang/:lang.json', (req, res) => {
  const file = path.join(LANG_DIR, `${req.params.lang}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({});
  res.sendFile(file);
});

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
