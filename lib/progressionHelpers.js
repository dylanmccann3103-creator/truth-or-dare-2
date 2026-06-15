'use strict';

/**
 * Returns true if `player` is allowed to access `level` given the room config.
 *
 * XP threshold for level N = 3 * N * (N - 1).
 * This equals the cumulative XP a player earns by completing exactly 3 dares
 * at each prior level (1 … N-1) at median difficulty (2):
 *   Σ_{i=1}^{N-1} (i × 2 × 3) = 6 · N(N-1)/2 = 3N(N-1)
 *
 * In addition to the XP threshold the player must have cleared the previous
 * level (≥ 3 completed dares there), matching levelUnlock = 'both' (§7.2).
 */
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

module.exports = { canAccessLevel, maxUnlockedLevel };
