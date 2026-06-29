'use strict';

/**
 * Pick a target player for the current dare.
 *
 * Modes:
 *   'self'   — always the performer
 *   'random' — uniformly random from other connected players
 *   '50-50'  — 50 % self, 50 % random other
 *
 * Disconnected players (connected === false) are always excluded.
 * excludeId removes a specific player from the candidate pool (used by
 * force_swap to exclude the current target).
 * Returns null only when excludeId is set and removes all candidates.
 */
function pickTarget(room, performerId, excludeId = null) {
  let others = room.turnOrder.filter(
    id => id !== performerId && room.players[id] && room.players[id].connected !== false
  );
  if (excludeId) others = others.filter(id => id !== excludeId);
  if (others.length === 0) return excludeId ? null : performerId;

  const mode = room.targetingMode;
  if (mode === 'self') return performerId;
  if (mode === 'random') return others[Math.floor(Math.random() * others.length)];
  return Math.random() < 0.5
    ? performerId
    : others[Math.floor(Math.random() * others.length)];
}

module.exports = { pickTarget };
