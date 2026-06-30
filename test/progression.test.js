'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canAccessLevel, maxUnlockedLevel } = require('../lib/progressionHelpers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function player(overrides = {}) {
  return { xp: 0, clearedLevels: [], currentLevel: 1, ...overrides };
}

function room(overrides = {}) {
  return { minLevel: 1, maxLevel: 10, levelMode: 'locked', ...overrides };
}

// ─── canAccessLevel: always-open cases ───────────────────────────────────────

test('canAccessLevel: level 1 is always accessible regardless of XP', () => {
  assert.equal(canAccessLevel(player({ xp: 0 }), 1, room()), true);
});

test('canAccessLevel: level above room maxLevel is blocked', () => {
  const richPlayer = player({ xp: 9999, clearedLevels: [1,2,3,4,5,6,7,8,9] });
  assert.equal(canAccessLevel(richPlayer, 6, room({ maxLevel: 5 })), false);
});

test('canAccessLevel: levelMode free allows any level without XP or cleared levels', () => {
  const p = player({ xp: 0, clearedLevels: [] });
  const freeRoom = room({ levelMode: 'free' });
  assert.equal(canAccessLevel(p, 2, freeRoom), true);
  assert.equal(canAccessLevel(p, 7, freeRoom), true);
  assert.equal(canAccessLevel(p, 10, freeRoom), true);
});

test('canAccessLevel: levels at or below minLevel are accessible with no progression', () => {
  const p = player({ xp: 0, clearedLevels: [] });
  const r = room({ minLevel: 3 });
  assert.equal(canAccessLevel(p, 1, r), true, 'below minLevel');
  assert.equal(canAccessLevel(p, 2, r), true, 'below minLevel');
  assert.equal(canAccessLevel(p, 3, r), true, 'at minLevel');
  assert.equal(canAccessLevel(p, 4, r), false, 'above minLevel needs progression');
});

// ─── canAccessLevel: XP thresholds ───────────────────────────────────────────
//
// Formula: xpThreshold(N) = N * 6  (linear, per CLAUDE.md §7.2)
//   level 2  →  2×6 = 12 XP  +  cleared [1]
//   level 3  →  3×6 = 18 XP  +  cleared [2]
//   level 4  →  4×6 = 24 XP  +  cleared [3]
//   level 5  →  5×6 = 30 XP  +  cleared [4]
//   level 10 → 10×6 = 60 XP  +  cleared [9]

test('canAccessLevel: level 2 requires 12 XP + cleared level 1', () => {
  const r = room();
  assert.equal(canAccessLevel(player({ xp: 11, clearedLevels: [1] }), 2, r), false, '1 XP short');
  assert.equal(canAccessLevel(player({ xp: 12, clearedLevels: [] }),  2, r), false, 'XP met but level 1 not cleared');
  assert.equal(canAccessLevel(player({ xp: 12, clearedLevels: [1] }), 2, r), true,  'exact threshold');
  assert.equal(canAccessLevel(player({ xp: 20, clearedLevels: [1] }), 2, r), true,  'above threshold');
});

test('canAccessLevel: level 3 requires 18 XP + cleared level 2', () => {
  const r = room();
  assert.equal(canAccessLevel(player({ xp: 17, clearedLevels: [1,2] }), 3, r), false, '1 XP short');
  assert.equal(canAccessLevel(player({ xp: 18, clearedLevels: [1]   }), 3, r), false, 'level 2 not cleared');
  assert.equal(canAccessLevel(player({ xp: 18, clearedLevels: [1,2] }), 3, r), true,  'exact threshold');
});

test('canAccessLevel: level 4 requires 24 XP + cleared level 3', () => {
  const r = room();
  assert.equal(canAccessLevel(player({ xp: 24, clearedLevels: [1,2,3] }), 4, r), true);
  assert.equal(canAccessLevel(player({ xp: 23, clearedLevels: [1,2,3] }), 4, r), false);
});

test('canAccessLevel: level 5 requires 30 XP + cleared level 4', () => {
  const r = room();
  assert.equal(canAccessLevel(player({ xp: 30, clearedLevels: [1,2,3,4] }), 5, r), true);
  assert.equal(canAccessLevel(player({ xp: 29, clearedLevels: [1,2,3,4] }), 5, r), false);
});

test('canAccessLevel: clearedLevels must include the immediately prior level', () => {
  // Skipping level 2 in clearedLevels should block access to level 3,
  // even with ample XP and level 1 cleared.
  const p = player({ xp: 999, clearedLevels: [1] });
  assert.equal(canAccessLevel(p, 3, room()), false, 'missing level 2 in clearedLevels blocks level 3');
});

test('canAccessLevel: level 10 requires 60 XP + cleared level 9', () => {
  const r = room();
  assert.equal(canAccessLevel(player({ xp: 60, clearedLevels: [1,2,3,4,5,6,7,8,9] }), 10, r), true);
  assert.equal(canAccessLevel(player({ xp: 59, clearedLevels: [1,2,3,4,5,6,7,8,9] }), 10, r), false);
});

// ─── maxUnlockedLevel ─────────────────────────────────────────────────────────

test('maxUnlockedLevel: fresh player with no XP returns 1 (minLevel)', () => {
  assert.equal(maxUnlockedLevel(player(), room()), 1);
});

test('maxUnlockedLevel: returns 2 when level-2 requirements are met', () => {
  const p = player({ xp: 12, clearedLevels: [1] });
  assert.equal(maxUnlockedLevel(p, room()), 2);
});

test('maxUnlockedLevel: returns 3 when level-3 requirements are met', () => {
  const p = player({ xp: 18, clearedLevels: [1, 2] }); // 3×6=18
  assert.equal(maxUnlockedLevel(p, room()), 3);
});

test('maxUnlockedLevel: is capped by room maxLevel', () => {
  const p = player({ xp: 9999, clearedLevels: [1,2,3,4,5,6,7,8,9] });
  assert.equal(maxUnlockedLevel(p, room({ maxLevel: 5 })), 5);
});

test('maxUnlockedLevel: free mode returns maxLevel regardless of XP', () => {
  const p = player({ xp: 0, clearedLevels: [] });
  assert.equal(maxUnlockedLevel(p, room({ levelMode: 'free', maxLevel: 8 })), 8);
});
