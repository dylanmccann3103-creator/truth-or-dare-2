'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectCard } = require('../lib/selectCard');
const {
  calcRewards, applyImmunity, POWERUP_COSTS,
  GENITAL_VOCAB, GENDER_WILDCARD, mergeGenders,
  clothingCategory, eligibleClothingItems, pickClothingItem,
  isClothingRemovalCard, clothingTokenKind, renderTokens, selectTarget,
} = require('../lib/gameHelpers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function player(overrides = {}) {
  return {
    id: 'p1', name: 'Test', gender: 'male', genitals: ['penis'],
    orientation: 'bi', availableForAllCombos: false,
    limits: [], preferences: [],
    ...overrides,
  };
}

function card(overrides = {}) {
  return {
    id: 'c1', type: 'dare', level: 3, difficulty: 2,
    text: 'Test dare NL',
    tags: ['physical'],
    genderRequired: null,
    performerGenitals: null, targetGenitals: null,
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

// ─── Tests 8: Performer / target genital filtering (OR / ANY logic) ───────────
test('performer genital mismatch blocks card', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina'], tags: [], level: 3 })];
  const performer = player({ genitals: ['penis'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'Performer lacking required genital should block card');
});

test('performer with matching genital passes filter', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina'], tags: [], level: 3 })];
  const performer = player({ genitals: ['vagina', 'breasts'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.notEqual(result, null, 'Performer with matching genital should get the card');
});

test('OR logic: card with [vagina,anus] passes for performer with only anus', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina', 'anus'], tags: [], level: 3 })];
  const performer = player({ genitals: ['anus'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.notEqual(result, null, 'Having any one listed genital should pass the filter');
});

test('OR logic: card with [vagina,anus] passes for performer with only vagina', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina', 'anus'], tags: [], level: 3 })];
  const performer = player({ genitals: ['vagina'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.notEqual(result, null, 'Vagina alone satisfies [vagina,anus] requirement');
});

test('OR logic: card with [vagina,anus] blocked for performer with only penis', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina', 'anus'], tags: [], level: 3 })];
  const performer = player({ genitals: ['penis'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'None of the listed genitals present should block card');
});

test('empty genitals blocks cards with genital requirements', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['vagina'], tags: [], level: 3 })];
  const performer = player({ genitals: [] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.equal(result, null, 'No genitals selected should block genital-required cards');
});

test('target genital mismatch blocks card', () => {
  const cards = [card({ id: 'c1', targetGenitals: ['penis'], tags: [], level: 3, targetRequired: true })];
  const performer = player({ id: 'p1', genitals: ['vagina'] });
  const target    = player({ id: 'p2', genitals: ['vagina'] });
  const { card: result } = selectCard(cards, 'dare', performer, target, 3, emptySet);
  assert.equal(result, null, 'Target lacking required genital should block card');
});

test('breasts and anus are valid genital options (no "mouth" — oral is a tag)', () => {
  const cards = [card({ id: 'c1', performerGenitals: ['breasts'], tags: [], level: 3 })];
  const performer = player({ genitals: ['breasts', 'vagina'] });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.notEqual(result, null, 'breasts should work as a valid genital filter value');
  assert.ok(!GENITAL_VOCAB.includes('mouth'), 'mouth must NOT be part of the genital vocabulary');
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

// ─── Phase 3 tests ────────────────────────────────────────────────────────────

// Helper: pure buy-powerup validation (mirrors server logic)
function validateBuyPowerup(player, powerupId, enabledPowerups) {
  const cost = POWERUP_COSTS[powerupId];
  if (!cost) return { ok: false, error: 'Unknown powerup' };
  if (!enabledPowerups.includes(powerupId)) return { ok: false, error: 'Powerup not enabled' };
  if (player.coins < cost) return { ok: false, error: 'Not enough coins' };
  return { ok: true };
}

// Helper: pure duel auto-win override (mirrors server logic)
function resolveWinnerId(turn, passedWinnerId) {
  return turn.duelAutoWinnerId || passedWinnerId;
}

// ─── Test 18: buy-powerup insufficient coins → rejected ───────────────────────
test('buy-powerup: insufficient coins returns error', () => {
  const p = { coins: 5 };
  const res = validateBuyPowerup(p, 'skip', ['skip']);
  assert.equal(res.ok, false, 'Should reject when player cannot afford powerup');
  assert.ok(res.error.includes('coins'), 'Error should mention coins');
});

test('buy-powerup: disabled powerup returns error', () => {
  const p = { coins: 100 };
  const res = validateBuyPowerup(p, 'skip', []); // skip not in enabledPowerups
  assert.equal(res.ok, false, 'Should reject disabled powerup');
});

test('buy-powerup: sufficient coins and enabled powerup succeeds', () => {
  const p = { coins: 10 };
  const res = validateBuyPowerup(p, 'skip', ['skip']); // skip costs 8
  assert.equal(res.ok, true, 'Should accept valid purchase');
});

// ─── Test 19: double_xp flag doubles XP from calcRewards ─────────────────────
test('double_xp flag returns 2× XP amount', () => {
  const testCard = { level: 3, difficulty: 2 };
  const attribution = { type: 'solo', performerId: 'p1' };
  const { xpEarned: normal } = calcRewards(testCard, attribution, 'schaars', false);
  const { xpEarned: doubled } = calcRewards(testCard, attribution, 'schaars', true);
  assert.equal(normal, 6, 'Normal XP should be level(3) × difficulty(2) = 6');
  assert.equal(doubled, 12, 'Doubled XP should be 12');
  assert.equal(doubled, normal * 2, 'Doubled XP should be exactly 2× normal');
});

// ─── Test 20: immunity at 100% — performer always immune ──────────────────────
test('immunity at 100%: performer is always immune (Math.random mocked to 0.0)', () => {
  const origRandom = Math.random;
  Math.random = () => 0.0; // always below threshold
  try {
    const immune = applyImmunity({ immunity: 1.0 });
    assert.equal(immune, true, 'immunity=1.0 with random=0.0 should always be immune');
  } finally {
    Math.random = origRandom;
  }
});

// ─── Test 21: immunity at 0% — performer never immune ────────────────────────
test('immunity at 0%: performer is never immune', () => {
  const origRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const immune = applyImmunity({ immunity: 0 });
    assert.equal(immune, false, 'immunity=0 should never trigger');
  } finally {
    Math.random = origRandom;
  }
});

// ─── Test 22: duel auto-win overrides passed winnerId ────────────────────────
test('duelAutoWinnerId overrides any passed winnerId in resolve-duel', () => {
  const turn = { duelAutoWinnerId: 'performer_id' };
  const resolved = resolveWinnerId(turn, 'other_player_id');
  assert.equal(resolved, 'performer_id', 'duelAutoWinnerId should override passedWinnerId');
});

test('resolve-duel uses passedWinnerId when duelAutoWinnerId is null', () => {
  const turn = { duelAutoWinnerId: null };
  const resolved = resolveWinnerId(turn, 'other_player_id');
  assert.equal(resolved, 'other_player_id', 'Should use passedWinnerId when no auto-win is set');
});

// ─── Gender: prefer_not_to_say matches any genderRequired ─────────────────────
test('prefer_not_to_say gender matches a gendered card without availableForAllCombos', () => {
  const cards = [card({ id: 'c1', genderRequired: ['female'], tags: [], level: 3 })];
  const performer = player({ gender: GENDER_WILDCARD, availableForAllCombos: false });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.ok(result, 'prefer_not_to_say should match any genderRequired card');
});

test('a different concrete gender is still blocked by genderRequired', () => {
  const cards = [card({ id: 'c1', genderRequired: ['female'], tags: [], level: 3 })];
  const male = player({ gender: 'male', availableForAllCombos: false });
  const { card: result } = selectCard(cards, 'dare', male, null, 3, emptySet);
  assert.equal(result, null, 'male performer should not get a female-only card');
});

test('custom (pack) gender matches a card requiring that custom gender — no hardcoding', () => {
  const cards = [card({ id: 'c1', genderRequired: ['femboy'], tags: [], level: 3 })];
  const performer = player({ gender: 'femboy', availableForAllCombos: false });
  const { card: result } = selectCard(cards, 'dare', performer, null, 3, emptySet);
  assert.ok(result, 'filter must match arbitrary gender strings, not just male/female');
});

test('mergeGenders adds pack genders and de-dupes by id', () => {
  const base = [{ id: 'male', label: 'Male' }, { id: 'female', label: 'Female' }];
  const merged = mergeGenders(base, [{ id: 'female', label: 'Dup' }, { id: 'femboy', label: 'Femboy' }]);
  assert.equal(merged.length, 3, 'duplicate ids are not added twice');
  assert.ok(merged.some(g => g.id === 'femboy'), 'new pack gender is merged in');
  assert.equal(merged.find(g => g.id === 'female').label, 'Female', 'existing gender keeps its original label');
});

// ─── Candidate-target array model ─────────────────────────────────────────────
test('targetRequired card passes when AT LEAST ONE candidate is valid', () => {
  const cards = [card({ id: 'c1', targetRequired: true, tags: ['feet'], level: 3 })];
  const performer = player({ id: 'pa' });
  const blocked = player({ id: 'b', limits: ['feet'] });   // would block on feet
  const okCand  = player({ id: 'o', limits: [] });
  const { card: result, validTargets } = selectCard(cards, 'dare', performer, [blocked, okCand], 3, emptySet);
  assert.ok(result, 'card eligible because one candidate is valid');
  assert.deepEqual(validTargets.map(t => t.id), ['o'], 'only the non-limited candidate is valid');
});

test('targetRequired card is ineligible when NO candidate is valid', () => {
  const cards = [card({ id: 'c1', targetRequired: true, tags: ['feet'], level: 3 })];
  const performer = player({ id: 'pa' });
  const blocked1 = player({ id: 'b1', limits: ['feet'] });
  const blocked2 = player({ id: 'b2', limits: ['feet'] });
  const { card: result } = selectCard(cards, 'dare', performer, [blocked1, blocked2], 3, emptySet);
  assert.equal(result, null, 'no valid candidate target → card not served');
});

test('target genitals filter applied across candidate pool', () => {
  const cards = [card({ id: 'c1', targetRequired: true, targetGenitals: ['penis'], tags: [], level: 3 })];
  const performer = player({ id: 'pa' });
  const noPenis = player({ id: 'n', genitals: ['vagina'] });
  const hasPenis = player({ id: 'p', genitals: ['penis'] });
  const { validTargets } = selectCard(cards, 'dare', performer, [noPenis, hasPenis], 3, emptySet);
  assert.deepEqual(validTargets.map(t => t.id), ['p'], 'only the candidate with the required genital is valid');
});

// ─── selectTarget: limits- and preference-aware weighted draw ─────────────────
test('selectTarget returns the only valid target', () => {
  const only = player({ id: 'only' });
  assert.equal(selectTarget([only], card()).id, 'only');
});

test('selectTarget biases toward a preference match (rng forced low picks weighted)', () => {
  const liker   = player({ id: 'liker', preferences: ['intimate'] }); // weight 3
  const neutral = player({ id: 'neutral' });                          // weight 2
  const c = card({ tags: ['intimate'] });
  // rng=0 → first slice; liker is listed first and out-weights neutral regardless
  assert.equal(selectTarget([liker, neutral], c, () => 0).id, 'liker');
});

test('selectTarget down-weights a soft-limit target vs a neutral one', () => {
  const soft    = player({ id: 'soft', softLimits: ['intimate'] }); // weight 1
  const neutral = player({ id: 'neutral' });                        // weight 2
  const c = card({ tags: ['intimate'] });
  // total weight 3; rng just past soft's slice (1/3) should land on neutral
  assert.equal(selectTarget([soft, neutral], c, () => 0.5).id, 'neutral');
});

// ─── Clothing: category mapping ───────────────────────────────────────────────
test('clothingCategory maps slot keys to categories', () => {
  assert.equal(clothingCategory({ key: 'head_hat', value: 'hat' }), 'headwear');
  assert.equal(clothingCategory({ key: 'neck_scarf', value: 'scarf' }), 'scarf');
  assert.equal(clothingCategory({ key: 'body_t-shirt', value: 't-shirt' }), 'upper');
  assert.equal(clothingCategory({ key: 'jacket_hoodie', value: 'hoodie' }), 'upper');
  assert.equal(clothingCategory({ key: 'legs_pants', value: 'pants' }), 'pants');
  assert.equal(clothingCategory({ key: 'underwear_boxers', value: 'boxers' }), 'underwear');
  assert.equal(clothingCategory({ key: 'foot_left_socks', value: 'socks' }), 'socks');
  assert.equal(clothingCategory({ key: 'extra_123', value: 'lace bra' }), 'underwear', 'free-text fallback');
});

// ─── Clothing: eligibility by level + difficulty tier ─────────────────────────
const wardrobe = () => ([
  { key: 'head_hat',         value: 'hat',    removed: false }, // headwear d1 minLvl6
  { key: 'body_t-shirt',     value: 't-shirt', removed: false }, // upper d2 minLvl7
  { key: 'underwear_boxers', value: 'boxers', removed: false }, // underwear d3 (d2 @8) minLvl7
]);

test('no clothing removal below level 6 — nothing eligible at level 5', () => {
  const c = { level: 5, difficulty: 1, tags: ['clothing'] };
  assert.equal(eligibleClothingItems(c, wardrobe()).length, 0);
});

test('level 6 difficulty 1 makes only headwear/scarf/socks eligible', () => {
  const c = { level: 6, difficulty: 1, tags: ['clothing'] };
  const elig = eligibleClothingItems(c, wardrobe());
  assert.deepEqual(elig.map(i => i.key), ['head_hat']);
});

test('level 7 difficulty 2 makes upper/pants eligible (not underwear yet)', () => {
  const c = { level: 7, difficulty: 2, tags: ['clothing'] };
  const elig = eligibleClothingItems(c, wardrobe());
  assert.deepEqual(elig.map(i => i.key), ['body_t-shirt']);
});

test('level 7 difficulty 3 makes underwear eligible', () => {
  const c = { level: 7, difficulty: 3, tags: ['clothing'] };
  const elig = eligibleClothingItems(c, wardrobe());
  assert.deepEqual(elig.map(i => i.key), ['underwear_boxers']);
});

test('level 8 underwear adjustment: underwear becomes difficulty 2', () => {
  const d2 = { level: 8, difficulty: 2, tags: ['clothing'] };
  const d3 = { level: 8, difficulty: 3, tags: ['clothing'] };
  assert.ok(eligibleClothingItems(d2, wardrobe()).some(i => i.key === 'underwear_boxers'), 'underwear is difficulty 2 at level 8');
  assert.ok(!eligibleClothingItems(d3, wardrobe()).some(i => i.key === 'underwear_boxers'), 'underwear no longer difficulty 3 at level 8');
});

test('removed items are never eligible', () => {
  const items = [{ key: 'head_hat', value: 'hat', removed: true }];
  assert.equal(eligibleClothingItems({ level: 6, difficulty: 1, tags: ['clothing'] }, items).length, 0);
});

// ─── Clothing: selectCard serving eligibility + pacing ────────────────────────
test('clothing-removal card filtered out when performer has no eligible garment', () => {
  const cards = [card({ id: 'c1', tags: ['clothing'], level: 7, difficulty: 2 })];
  const performer = player({ clothingItems: [{ key: 'head_hat', value: 'hat', removed: false }] }); // only headwear (d1)
  const { card: result } = selectCard(cards, 'dare', performer, [], 7, emptySet);
  assert.equal(result, null, 'no still-on item in the card tier → not served');
});

test('clothing-removal card served when performer has an eligible garment', () => {
  const cards = [card({ id: 'c1', tags: ['clothing'], level: 6, difficulty: 1 })];
  const performer = player({ clothingItems: [{ key: 'head_hat', value: 'hat', removed: false }] });
  const { card: result } = selectCard(cards, 'dare', performer, [], 6, emptySet);
  assert.ok(result, 'eligible headwear at level 6 difficulty 1 → served');
});

test('strip-streak guardrail: clothing card filtered after 2 strips in a row', () => {
  const cards = [card({ id: 'c1', tags: ['clothing'], level: 6, difficulty: 1 })];
  const performer = player({
    clothingItems: [{ key: 'head_hat', value: 'hat', removed: false }],
    clothingStreak: 2,
  });
  const { card: result } = selectCard(cards, 'dare', performer, [], 6, emptySet);
  assert.equal(result, null, 'after 2 strips in a row the next draw must be non-clothing');
});

// ─── Tokens ───────────────────────────────────────────────────────────────────
test('clothingTokenKind detects {{ct}} over {{c}}', () => {
  assert.equal(clothingTokenKind({ text: 'remove {{c}}', tags: ['clothing'] }), 'c');
  assert.equal(clothingTokenKind({ text: 'take off {{ct}}', tags: ['clothing'] }), 'ct');
  assert.equal(clothingTokenKind({ text: 'no token', tags: ['clothing'] }), null);
});

test('isClothingRemovalCard keys off the clothing tag', () => {
  assert.equal(isClothingRemovalCard({ tags: ['clothing'] }), true);
  assert.equal(isClothingRemovalCard({ tags: ['intimate'] }), false);
});

test('renderTokens substitutes PA/PB/c/ct in a string and an {nl,en} object', () => {
  const out = renderTokens('{{PA}} removes {{PB}}’s {{ct}} and own {{c}}', {
    paName: 'Ann', pbName: 'Bo', cLabel: 'hat', ctLabel: 'scarf',
  });
  assert.equal(out, 'Ann removes Bo’s scarf and own hat');
  const obj = renderTokens({ nl: '{{PA}} kust {{PB}}', en: '{{PA}} kisses {{PB}}' }, { paName: 'Ann', pbName: 'Bo' });
  assert.deepEqual(obj, { nl: 'Ann kust Bo', en: 'Ann kisses Bo' });
});

test('pickClothingItem returns null on empty list and an item otherwise', () => {
  assert.equal(pickClothingItem([], 6), null);
  const items = [{ key: 'head_hat', value: 'hat', removed: false }];
  assert.equal(pickClothingItem(items, 6, () => 0).key, 'head_hat');
});
