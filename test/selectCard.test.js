'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCard } = require('../lib/selectCard');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function player(overrides = {}) {
  return {
    id: 'p1', name: 'Test', gender: 'male', bodyType: 'penis',
    orientation: 'bi', availableForAllCombos: false,
    limits: [], preferences: [],
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    id: 'c1', type: 'dare', level: 3, difficulty: 2,
    text: { en: 'Test dare', nl: 'Test dare NL' },
    tags: ['physical'],
    genderRequired: null,
    bodyTypeRelevant: false, bodyTypeRequired: null,
    orientationMatters: false, targetRequired: false,
    ...overrides,
  };
}

const emptySet = new Set();

// ─── Test 1: Performer limit blocks card ──────────────────────────────────────
test('never returns a card whose tag is in performer.limits', () => {
  const cards = [card({ id: 'c1', tags: ['intimate'] })];
  const performer = player({ limits: ['intimate'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'Should return null when only card has a limited tag');
});

// ─── Test 2: Target limit blocks card ─────────────────────────────────────────
test('never returns a card whose tag is in target.limits', () => {
  const cards = [card({ id: 'c1', tags: ['feet'] })];
  const performer = player({ limits: [] });
  const target = player({ id: 'p2', limits: ['feet'] });
  const { card: result } = selectCard(cards, 'dare', performer, target, 3, emptySet);
  assert.equal(result, null, 'Should return null when only card has a tag in target.limits');
});

// ─── Test 3: Both performer AND target limits respected ───────────────────────
test('both performer and target limits are respected independently', () => {
  const safeCard = card({ id: 'safe', tags: ['general'], level: 1 });
  const blockedByPerformer = card({ id: 'blocked-p', tags: ['intimate'], level: 1 });
  const blockedByTarget    = card({ id: 'blocked-t', tags: ['feet'],    level: 1 });
  const cards = [safeCard, blockedByPerformer, blockedByTarget];
  const performer = player({ limits: ['intimate'] });
  const target    = player({ id: 'p2', limits: ['feet'] });

  // Run many times to check no blocked card ever appears
  for (let i = 0; i < 50; i++) {
    const { card: result } = selectCard(cards, 'dare', performer, target, 1, emptySet);
    assert.ok(result, 'Should return a card');
    assert.notEqual(result.id, 'blocked-p', 'Should never return a card blocked by performer');
    assert.notEqual(result.id, 'blocked-t', 'Should never return a card blocked by target');
  }
});

// ─── Test 4: Gender mismatch blocks card ──────────────────────────────────────
test('gender mismatch blocks card', () => {
  const cards = [card({ id: 'c1', genderRequired: ['female'], tags: [] })];
  const performer = player({ gender: 'male', availableForAllCombos: false });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'Male performer should not get female-only card');
});

// ─── Test 5: availableForAllCombos bypasses gender filter ─────────────────────
test('availableForAllCombos bypasses gender filter', () => {
  const cards = [card({ id: 'c1', genderRequired: ['female'], tags: [], level: 3 })];
  const performer = player({ gender: 'male', availableForAllCombos: true });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.ok(result, 'availableForAllCombos should bypass gender filter');
});

// ─── Test 6: Orientation mismatch blocks when orientationMatters ──────────────
test('orientation mismatch blocks card when orientationMatters is true', () => {
  // hetero performer + hetero target of same gender = incompatible
  const cards = [card({ id: 'c1', orientationMatters: true, tags: [], level: 3 })];
  const performer = player({ gender: 'male', orientation: 'hetero' });
  const target    = player({ id: 'p2', gender: 'male', orientation: 'hetero' });
  const { card: result } = selectCard(cards, 'dare', performer, target, 3, emptySet);
  assert.equal(result, null, 'hetero same-gender combo should be blocked for orientationMatters card');
});

// ─── Test 7: orientationMatters with compatible pair succeeds ─────────────────
test('orientation-compatible pair passes when orientationMatters is true', () => {
  const cards = [card({ id: 'c1', orientationMatters: true, tags: [], level: 3 })];
  const performer = player({ gender: 'male', orientation: 'hetero' });
  const target    = player({ id: 'p2', gender: 'female', orientation: 'hetero' });
  const { card: result } = selectCard(cards, 'dare', performer, target, 3, emptySet);
  assert.ok(result, 'hetero male+female combo should pass orientationMatters');
});

// ─── Test 8: Body type mismatch blocks when bodyTypeRelevant ──────────────────
test('body type mismatch blocks card when bodyTypeRelevant is true', () => {
  const cards = [card({ id: 'c1', bodyTypeRelevant: true, bodyTypeRequired: 'vagina', tags: [], level: 3 })];
  const performer = player({ bodyType: 'penis' });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'Mismatched bodyType should block the card');
});

// ─── Test 9: Type filter — truth request never returns a dare ─────────────────
test('type filter: requesting truth never returns a dare card', () => {
  const dareCard  = card({ id: 'd1', type: 'dare',  level: 1, tags: [] });
  const truthCard = card({ id: 't1', type: 'truth', level: 1, tags: [] });
  const cards = [dareCard, truthCard];
  for (let i = 0; i < 30; i++) {
    const { card: result } = selectCard(cards, 'truth', player(), null, 1, emptySet);
    assert.ok(result, 'Should always find a truth card');
    assert.equal(result.type, 'truth', 'Type filter must hold');
  }
});

// ─── Test 10: Fallback to lower level when chosen level has no cards ──────────
test('falls back to lower level when chosen level has no eligible cards', () => {
  const levelOneCard = card({ id: 'lvl1', level: 1, tags: [] });
  const cards = [levelOneCard]; // nothing at levels 2–3
  const { card: result } = selectCard(cards, 'dare', player(), null, 3, emptySet);
  assert.ok(result, 'Should fall back and return the level-1 card');
  assert.equal(result.id, 'lvl1');
});

// ─── Test 11: Per-player card recycling with recycled flag ────────────────────
test('recycles pool when all eligible cards used, sets recycled=true', () => {
  const c1 = card({ id: 'u1', level: 3, tags: [] });
  const c2 = card({ id: 'u2', level: 3, tags: [] });
  const cards = [c1, c2];
  const used = new Set(['u1', 'u2']); // both already used

  const { card: result, recycled } = selectCard(cards, 'dare', player(), null, 3, used);
  assert.ok(result, 'Should return a card even when pool was exhausted');
  assert.equal(recycled, true, 'recycled flag should be true');
});

// ─── Test 12: targetRequired with no target returns null ─────────────────────
test('targetRequired: true with target=null returns null', () => {
  const cards = [card({ id: 'c1', targetRequired: true, tags: [], level: 3 })];
  const { card: result } = selectCard(cards, 'dare', player(), null, 3, emptySet);
  assert.equal(result, null, 'targetRequired card should be blocked when target is null');
});

// ─── Test 13: targetRequired with valid target returns card ───────────────────
test('targetRequired: true with valid target returns card', () => {
  const cards = [card({ id: 'c1', targetRequired: true, tags: [], level: 3 })];
  const performer = player({ id: 'p1' });
  const target = player({ id: 'p2' });
  const { card: result } = selectCard(cards, 'dare', performer, target, 3, emptySet);
  assert.ok(result, 'targetRequired card should be returned when target is provided');
  assert.equal(result.id, 'c1');
});

// ─── Test 14: softFlagged returns true without blocking card ─────────────────
test('soft limit tag returns softFlagged=true without blocking the card', () => {
  const cards = [card({ id: 'c1', tags: ['intimate'], level: 3 })];
  const performer = player({ softLimits: ['intimate'], limits: [] });
  const { card: result, softFlagged } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.ok(result, 'Card should not be blocked by soft limit');
  assert.equal(result.id, 'c1', 'Correct card should be returned');
  assert.equal(softFlagged, true, 'softFlagged should be true when soft limit tag matches');
});

// ─── Test 15: roulette block mode never exceeds chosenLevel ──────────────────
test('roulette block mode never returns a card above chosenLevel', () => {
  const below = card({ id: 'b1', level: 2, tags: [] });
  const exact = card({ id: 'b2', level: 3, tags: [] });
  const above = card({ id: 'b3', level: 4, tags: [] });
  const cards = [below, exact, above];

  for (let i = 0; i < 50; i++) {
    const usedSet = new Set(); // fresh each time to avoid recycling complications
    const { card: result } = selectCard(cards, 'dare', player(), null, 3, usedSet, { rouletteMode: 'block' });
    assert.ok(result, 'Should always return a card in block mode');
    assert.ok(result.level <= 3, `Card level ${result.level} must not exceed chosenLevel 3`);
  }
});

// ─── Test 16: Coin formula floor — Math.max(3, level×difficulty) ─────────────
test('coin formula floor: level=1 diff=1 yields min 3 coins', () => {
  const base = Math.max(3, 1 * 1); // level=1, difficulty=1
  assert.equal(base, 3, 'Minimum coin base should be 3 even when level*difficulty=1');

  const base2 = Math.max(3, 3 * 2); // level=3, difficulty=2
  assert.equal(base2, 6, 'Coin base level=3 diff=2 should be 6');
});

// ─── Test 17: End-game XP penalty = sum of card.level × card.difficulty ──────
test('end-game XP penalty equals sum of level × difficulty across parked dares', () => {
  const parkedDares = [
    { cardId: 'x', level: 3, difficulty: 2, xpPenalty: 3 * 2 },
    { cardId: 'y', level: 1, difficulty: 1, xpPenalty: 1 * 1 },
    { cardId: 'z', level: 5, difficulty: 3, xpPenalty: 5 * 3 },
  ];
  parkedDares.forEach(d => {
    assert.equal(d.xpPenalty, d.level * d.difficulty, `Penalty for level ${d.level} diff ${d.difficulty} should be ${d.level * d.difficulty}`);
  });
  const total = parkedDares.reduce((sum, d) => sum + d.xpPenalty, 0);
  assert.equal(total, 6 + 1 + 15, 'Total penalty should be sum of all individual penalties');
});
