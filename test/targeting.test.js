'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickTarget } = require('../lib/targeting');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoom(turnOrder, players, targetingMode = '50-50') {
  const playerMap = {};
  for (const [id, overrides] of Object.entries(players)) {
    playerMap[id] = { connected: true, ...overrides };
  }
  return { turnOrder, players: playerMap, targetingMode };
}

// ─── self mode ────────────────────────────────────────────────────────────────

test('pickTarget self mode: always returns the performer', () => {
  const room = makeRoom(['p1','p2','p3'], { p1:{}, p2:{}, p3:{} }, 'self');
  for (let i = 0; i < 20; i++) {
    assert.equal(pickTarget(room, 'p1'), 'p1', 'self mode must always return performer');
  }
});

// ─── random mode ─────────────────────────────────────────────────────────────

test('pickTarget random mode: never returns the performer when others exist', () => {
  const room = makeRoom(['p1','p2','p3'], { p1:{}, p2:{}, p3:{} }, 'random');
  for (let i = 0; i < 50; i++) {
    const result = pickTarget(room, 'p1');
    assert.notEqual(result, 'p1', 'random mode must not return performer');
    assert.ok(['p2','p3'].includes(result), `result "${result}" should be p2 or p3`);
  }
});

test('pickTarget random mode: skips disconnected players', () => {
  const room = makeRoom(
    ['p1','p2','p3'],
    { p1:{}, p2:{ connected: false }, p3:{} },
    'random'
  );
  for (let i = 0; i < 30; i++) {
    const result = pickTarget(room, 'p1');
    assert.notEqual(result, 'p2', 'disconnected p2 should never be chosen');
    assert.equal(result, 'p3');
  }
});

// ─── 50-50 mode ───────────────────────────────────────────────────────────────

test('pickTarget 50-50 mode: can return performer or another player', () => {
  const room = makeRoom(['p1','p2','p3'], { p1:{}, p2:{}, p3:{} }, '50-50');
  const results = new Set();
  for (let i = 0; i < 100; i++) results.add(pickTarget(room, 'p1'));
  assert.ok(results.has('p1'), '50-50 should sometimes return performer');
  assert.ok(results.size > 1,  '50-50 should sometimes return other players');
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test('pickTarget: solo player (no others) gets themselves as target', () => {
  const room = makeRoom(['p1'], { p1:{} }, 'random');
  assert.equal(pickTarget(room, 'p1'), 'p1');
});

test('pickTarget: excludeId removes that player from the candidate pool', () => {
  const room = makeRoom(['p1','p2','p3'], { p1:{}, p2:{}, p3:{} }, 'random');
  for (let i = 0; i < 30; i++) {
    const result = pickTarget(room, 'p1', 'p2');
    assert.notEqual(result, 'p2', 'excluded p2 must never be returned');
    assert.equal(result, 'p3');
  }
});

test('pickTarget: returns null when excludeId removes the only remaining candidate', () => {
  // p1 is performer; p2 is the only other player but explicitly excluded
  const room = makeRoom(['p1','p2'], { p1:{}, p2:{} }, 'random');
  const result = pickTarget(room, 'p1', 'p2');
  assert.equal(result, null, 'no candidates after exclusion → null');
});

test('pickTarget: players not in turnOrder are never selected', () => {
  // p3 exists in players but not in turnOrder
  const room = makeRoom(['p1','p2'], { p1:{}, p2:{}, p3:{} }, 'random');
  for (let i = 0; i < 30; i++) {
    const result = pickTarget(room, 'p1');
    assert.notEqual(result, 'p3', 'p3 is not in turnOrder so must never be targeted');
  }
});
