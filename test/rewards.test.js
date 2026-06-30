'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcRewards, coinsByEconomy } = require('../lib/gameHelpers');

// ─── coinsByEconomy ───────────────────────────────────────────────────────────

test('coinsByEconomy: schaars keeps base unchanged (×1)', () => {
  assert.equal(coinsByEconomy(6, 'schaars'), 6);
  assert.equal(coinsByEconomy(3, 'schaars'), 3);
});

test('coinsByEconomy: gemiddeld doubles the base (×2)', () => {
  assert.equal(coinsByEconomy(6, 'gemiddeld'), 12);
  assert.equal(coinsByEconomy(3, 'gemiddeld'), 6);
});

test('coinsByEconomy: overvloedig quadruples the base (×4)', () => {
  assert.equal(coinsByEconomy(6, 'overvloedig'), 24);
  assert.equal(coinsByEconomy(3, 'overvloedig'), 12);
});

test('coinsByEconomy: unknown or missing mode falls back to schaars (×1)', () => {
  assert.equal(coinsByEconomy(6, undefined), 6);
  assert.equal(coinsByEconomy(6, 'random_string'), 6);
});

test('coinsByEconomy: floor=3 input is still scaled (coinsByEconomy itself just multiplies)', () => {
  assert.equal(coinsByEconomy(3, 'gemiddeld'),   6);
  assert.equal(coinsByEconomy(3, 'overvloedig'), 12);
});

// ─── calcRewards — XP is independent of economy ──────────────────────────────

test('calcRewards: XP = level × difficulty regardless of economy mode', () => {
  const c = { level: 4, difficulty: 3 };
  const attr = { type: 'solo', performerId: 'p1' };
  const { xpEarned: xp1 } = calcRewards(c, attr, 'schaars');
  const { xpEarned: xp2 } = calcRewards(c, attr, 'overvloedig');
  assert.equal(xp1, 12, 'XP = 4×3 = 12');
  assert.equal(xp2, 12, 'Economy mode must not affect XP');
});

test('calcRewards: missing difficulty defaults to 1 for XP calculation', () => {
  const c = { level: 5 };
  const { xpEarned } = calcRewards(c, { type: 'solo', performerId: 'p1' }, 'schaars');
  assert.equal(xpEarned, 5, 'No difficulty field → XP = level × 1 = 5');
});

// ─── calcRewards — solo ───────────────────────────────────────────────────────

test('calcRewards solo: performer is the only coin recipient', () => {
  const c = { level: 3, difficulty: 2 };
  const { coinRecipients } = calcRewards(c, { type: 'solo', performerId: 'alice' }, 'schaars');
  assert.equal(coinRecipients.length, 1);
  assert.equal(coinRecipients[0].id, 'alice');
  assert.equal(coinRecipients[0].coins, 6); // max(3, 3×2×1)=6
});

test('calcRewards solo: gemiddeld doubles coin payout', () => {
  const c = { level: 3, difficulty: 2 };
  const { coinRecipients } = calcRewards(c, { type: 'solo', performerId: 'alice' }, 'gemiddeld');
  assert.equal(coinRecipients[0].coins, 12); // max(3, 3×2×2)=12
});

test('calcRewards solo: overvloedig quadruples coin payout', () => {
  const c = { level: 3, difficulty: 2 };
  const { coinRecipients } = calcRewards(c, { type: 'solo', performerId: 'alice' }, 'overvloedig');
  assert.equal(coinRecipients[0].coins, 24); // max(3, 3×2×4)=24
});

test('calcRewards solo: coin floor of 3 applied after economy — low-value card schaars', () => {
  const c = { level: 1, difficulty: 1 }; // 1×1×1=1 → floor kicks in → 3
  const { coinRecipients } = calcRewards(c, { type: 'solo', performerId: 'p1' }, 'schaars');
  assert.equal(coinRecipients[0].coins, 3);
});

test('calcRewards solo: coin floor of 3 applied after economy — low-value card gemiddeld', () => {
  const c = { level: 1, difficulty: 1 }; // 1×1×2=2 → floor kicks in → 3
  const { coinRecipients } = calcRewards(c, { type: 'solo', performerId: 'p1' }, 'gemiddeld');
  assert.equal(coinRecipients[0].coins, 3);
});

// ─── calcRewards — duel ───────────────────────────────────────────────────────

test('calcRewards duel: coins go to winner, not performer', () => {
  const c = { level: 4, difficulty: 2 };
  const { xpEarned, coinRecipients } = calcRewards(
    c, { type: 'duel', performerId: 'performer', winnerId: 'winner' }, 'schaars'
  );
  assert.equal(xpEarned, 8, 'XP = 4×2 = 8 (performer tracks this separately)');
  assert.equal(coinRecipients.length, 1);
  assert.equal(coinRecipients[0].id, 'winner', 'coins go to winner');
  assert.equal(coinRecipients[0].coins, 8); // max(3, 4×2×1)=8
});

test('calcRewards duel: performer winning their own duel receives the coins', () => {
  const c = { level: 3, difficulty: 2 };
  const { coinRecipients } = calcRewards(
    c, { type: 'duel', performerId: 'p1', winnerId: 'p1' }, 'schaars'
  );
  assert.equal(coinRecipients[0].id, 'p1', 'performer is the winner here');
});

test('calcRewards duel: no winnerId means zero coin recipients', () => {
  const c = { level: 3, difficulty: 2 };
  const { coinRecipients } = calcRewards(
    c, { type: 'duel', performerId: 'p1' }, 'schaars'
  );
  assert.equal(coinRecipients.length, 0, 'unresolved duel has no coin payout');
});

test('calcRewards duel: economy multiplier also applies to duel coins', () => {
  const c = { level: 3, difficulty: 2 }; // base=6
  const attr = { type: 'duel', performerId: 'p1', winnerId: 'p2' };
  const { coinRecipients: normal   } = calcRewards(c, attr, 'schaars');
  const { coinRecipients: doubled  } = calcRewards(c, attr, 'gemiddeld');
  const { coinRecipients: quadrupled } = calcRewards(c, attr, 'overvloedig');
  assert.equal(normal[0].coins,    6);
  assert.equal(doubled[0].coins,  12);
  assert.equal(quadrupled[0].coins, 24);
});

// ─── calcRewards — doubleXp powerup ──────────────────────────────────────────

test('calcRewards: doubleXp doubles XP but leaves coins unchanged', () => {
  const c = { level: 3, difficulty: 2 };
  const attr = { type: 'duel', performerId: 'p1', winnerId: 'p2' };
  const { xpEarned: normalXp,  coinRecipients: normalCoins  } = calcRewards(c, attr, 'schaars', false);
  const { xpEarned: doubledXp, coinRecipients: doubledCoins } = calcRewards(c, attr, 'schaars', true);
  assert.equal(doubledXp, normalXp * 2, 'XP should be doubled');
  assert.equal(doubledCoins[0].coins, normalCoins[0].coins, 'coins must not be affected by doubleXp');
});
