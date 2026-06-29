'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCard } = require('../lib/selectCard');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function player(overrides = {}) {
  return {
    id: 'p1', gender: 'male', genitals: ['penis'],
    orientation: 'bi', availableForAllCombos: false,
    limits: [], softLimits: [], preferences: [],
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    id: 'c1', type: 'dare', level: 3, difficulty: 2,
    text: 'Test dare',
    tags: ['physical'],
    genderRequired: null,
    performerGenitals: null, targetGenitals: null,
    orientationMatters: false, targetRequired: false,
    ...overrides,
  };
}

const emptySet = new Set();

// ─── Duel card type ───────────────────────────────────────────────────────────

test('selectCard accepts type="duel" and only returns duel cards', () => {
  const duelCard = card({ id: 'd1', type: 'duel', tags: [] });
  const dareCard = card({ id: 'dare1', type: 'dare', tags: [] });
  for (let i = 0; i < 30; i++) {
    const { card: result } = selectCard(
      [duelCard, dareCard], 'duel', player(), player({ id: 'p2' }), 3, emptySet
    );
    assert.ok(result, 'Should return a card');
    assert.equal(result.type, 'duel', 'type filter must hold for duel');
  }
});

test('selectCard duel: performer limits block duel cards just like dare cards', () => {
  const duelCard = card({ id: 'd1', type: 'duel', tags: ['intimate'] });
  const performer = player({ limits: ['intimate'] });
  const { card: result } = selectCard(
    [duelCard], 'duel', performer, player({ id: 'p2' }), 3, emptySet
  );
  assert.equal(result, null, 'performer limit must block duel cards');
});

test('selectCard duel: target limits block duel cards', () => {
  const duelCard = card({ id: 'd1', type: 'duel', tags: ['explicit'] });
  const target = player({ id: 'p2', limits: ['explicit'] });
  const { card: result } = selectCard(
    [duelCard], 'duel', player(), target, 3, emptySet
  );
  assert.equal(result, null, 'target limit must block duel cards');
});

test('selectCard duel: targetRequired card with no target is blocked', () => {
  const duelCard = card({ id: 'd1', type: 'duel', targetRequired: true, tags: [] });
  const { card: result } = selectCard([duelCard], 'duel', player(), null, 3, emptySet);
  assert.equal(result, null, 'targetRequired duel card needs a target');
});

// ─── Orientation edge cases ───────────────────────────────────────────────────

test('orientation: bi performer is compatible with any target orientation', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const biPerformer = player({ gender: 'male', orientation: 'bi' });

  const pairs = [
    player({ id: 'p2', gender: 'male',   orientation: 'hetero' }),
    player({ id: 'p3', gender: 'female', orientation: 'gay' }),
    player({ id: 'p4', gender: 'female', orientation: 'bi' }),
  ];
  for (const target of pairs) {
    const { card: result } = selectCard([c], 'dare', biPerformer, target, 3, emptySet);
    assert.ok(result, `bi + ${target.orientation} should be compatible`);
  }
});

test('orientation: bi target is compatible with any performer orientation', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const biTarget = player({ id: 'p2', gender: 'female', orientation: 'bi' });

  const performers = [
    player({ gender: 'male',   orientation: 'hetero' }),
    player({ gender: 'female', orientation: 'gay' }),
  ];
  for (const performer of performers) {
    const { card: result } = selectCard([c], 'dare', performer, biTarget, 3, emptySet);
    assert.ok(result, `${performer.orientation} + bi should be compatible`);
  }
});

test('orientation: gay male + gay male passes (same gender)', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const performer = player({ gender: 'male', orientation: 'gay' });
  const target    = player({ id: 'p2', gender: 'male', orientation: 'gay' });
  const { card: result } = selectCard([c], 'dare', performer, target, 3, emptySet);
  assert.ok(result, 'gay+gay same-gender is compatible');
});

test('orientation: gay male + gay female is blocked (different genders for gay orientation)', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const performer = player({ gender: 'male',   orientation: 'gay' });
  const target    = player({ id: 'p2', gender: 'female', orientation: 'gay' });
  const { card: result } = selectCard([c], 'dare', performer, target, 3, emptySet);
  assert.equal(result, null, 'gay+gay different-gender is incompatible');
});

test('orientation: hetero male + hetero female passes (different genders)', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const performer = player({ gender: 'male',   orientation: 'hetero' });
  const target    = player({ id: 'p2', gender: 'female', orientation: 'hetero' });
  const { card: result } = selectCard([c], 'dare', performer, target, 3, emptySet);
  assert.ok(result, 'hetero+hetero different-gender is compatible');
});

test('orientation: hetero male + hetero male is blocked (same gender)', () => {
  const c = card({ id: 'c1', orientationMatters: true, tags: [] });
  const performer = player({ gender: 'male', orientation: 'hetero' });
  const target    = player({ id: 'p2', gender: 'male', orientation: 'hetero' });
  const { card: result } = selectCard([c], 'dare', performer, target, 3, emptySet);
  assert.equal(result, null, 'hetero+hetero same-gender is incompatible');
});

test('orientation: orientationMatters=false never filters by orientation', () => {
  // Pair that would normally be blocked (hetero+same gender)
  const c = card({ id: 'c1', orientationMatters: false, tags: [] });
  const performer = player({ gender: 'male', orientation: 'hetero' });
  const target    = player({ id: 'p2', gender: 'male', orientation: 'hetero' });
  const { card: result } = selectCard([c], 'dare', performer, target, 3, emptySet);
  assert.ok(result, 'orientationMatters=false must not filter');
});

// ─── Preference weighting ─────────────────────────────────────────────────────

test('pickWeighted: preference-tagged cards are selected significantly more often', () => {
  const preferred    = card({ id: 'pref',    type: 'dare', level: 1, tags: ['intimate'] });
  const nonPreferred = card({ id: 'notpref', type: 'dare', level: 1, tags: ['general'] });
  const performer = player({ preferences: ['intimate'] });

  let prefCount = 0;
  const RUNS = 300;
  for (let i = 0; i < RUNS; i++) {
    const { card: result } = selectCard(
      [preferred, nonPreferred], 'dare', performer, null, 1, emptySet
    );
    if (result?.id === 'pref') prefCount++;
  }

  // 3× weight → preferred should win ~75% (3/4) of the time.
  // Conservative threshold >55% to stay flake-free.
  const ratio = prefCount / RUNS;
  assert.ok(
    ratio > 0.55,
    `Preference card should win >55% of selections — got ${(ratio * 100).toFixed(1)}%`
  );
});

// ─── Fallback chain ───────────────────────────────────────────────────────────

test('fallback chain: finds a card across multiple empty levels', () => {
  // Only a level-2 card exists; performer requests level 5
  const lvl2card = card({ id: 'l2', type: 'dare', level: 2, tags: [] });
  const { card: result } = selectCard([lvl2card], 'dare', player(), null, 5, emptySet);
  assert.ok(result, 'Should fall back all the way to level 2');
  assert.equal(result.id, 'l2');
});

test('last-resort fallback: returns a truth at level 1 when no dare card passes', () => {
  const truthCard = card({ id: 't1', type: 'truth', level: 1, tags: [] });
  // No dare exists, but a truth does
  const { card: result } = selectCard([truthCard], 'dare', player(), null, 5, emptySet);
  assert.ok(result, 'Should return truth card as last resort');
  assert.equal(result.type, 'truth');
  assert.equal(result.level, 1);
});

test('returns null when every card is blocked by performer limits at all levels', () => {
  const blockedCard = card({ id: 'b1', type: 'dare', level: 1, tags: ['intimate'] });
  const performer = player({ limits: ['intimate'] });
  const { card: result } = selectCard([blockedCard], 'dare', performer, null, 1, emptySet);
  assert.equal(result, null, 'Completely filtered pool must return null');
});
