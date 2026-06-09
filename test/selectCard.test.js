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
