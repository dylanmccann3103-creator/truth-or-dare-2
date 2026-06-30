'use strict';

/**
 * Returns true if `player` is allowed to access `level` given the room config.
 *
 * XP threshold for level N = N * 6  (linear, per CLAUDE.md §7.2).
 * A player clearing the previous level at median difficulty (3 dares × level × 2)
 * earns exactly N×6 XP when they finish those 3 dares, so the threshold is met
 * right as they clear it.
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
  const xpThreshold = level * 6;
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
