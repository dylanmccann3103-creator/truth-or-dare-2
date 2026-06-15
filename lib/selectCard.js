'use strict';

/**
 * selectCard — the safety guarantee for Truth or Dare 2.0.
 *
 * Returns a single Card from allCards that passes ALL filters for the
 * given performer/target/level, or null if no safe card exists.
 *
 * @param {object[]} allCards   - full dares.json card array
 * @param {string}   type       - 'truth' | 'dare'
 * @param {object}   performer  - Player object
 * @param {object|null} target  - Player object or null
 * @param {number}   chosenLevel - level the performer chose this turn
 * @param {Set}      usedCardIds - Set of card ids already used by this player
 * @param {object}   [options]
 * @param {string}   [options.rouletteMode] - 'off'|'block' (plus1 is resolved server-side)
 * @returns {{ card: object|null, recycled: boolean, softFlagged: boolean }}
 */
function selectCard(allCards, type, performer, target, chosenLevel, usedCardIds, options = {}) {
  const { rouletteMode = 'off' } = options;

  // Safety checks shared by passes() and the last-resort truth lookup.
  // Does NOT check card.type or card.level — callers handle those.
  function safetyClear(card) {
    if (card.tags && card.tags.some(t => (performer.limits || []).includes(t))) return false;
    if (target && card.tags && card.tags.some(t => (target.limits || []).includes(t))) return false;
    if (card.genderRequired && card.genderRequired.length > 0) {
      if (!performer.availableForAllCombos && !card.genderRequired.includes(performer.gender)) {
        return false;
      }
    }
    if (card.targetRequired && !target) return false;
    if (card.orientationMatters && target) {
      if (!orientationCompatible(performer, target)) return false;
    }
    if (card.performerGenitals && card.performerGenitals.length > 0) {
      const pg = performer.genitals || [];
      if (!card.performerGenitals.some(g => pg.includes(g))) return false;
    }
    if (target && card.targetGenitals && card.targetGenitals.length > 0) {
      const tg = target.genitals || [];
      if (!card.targetGenitals.some(g => tg.includes(g))) return false;
    }
    return true;
  }

  function passes(card, level) {
    if (card.type !== type) return false;
    if (rouletteMode === 'block') {
      if (card.level > level) return false;
    } else {
      if (card.level !== level) return false;
    }
    return safetyClear(card);
  }

  // Soft-limit detection: does NOT block, just flags the selected card
  function isSoftFlagged(card) {
    if (!card) return false;
    return (card.tags || []).some(t =>
      (performer.softLimits || []).includes(t) ||
      (target && (target.softLimits || []).includes(t))
    );
  }

  // Build eligible pool for a given level, ignoring usedCardIds first
  function eligible(level) {
    return allCards.filter(c => !usedCardIds.has(c.id) && passes(c, level));
  }

  // Fallback chain: chosenLevel → chosenLevel-1 → … → 1
  for (let lvl = chosenLevel; lvl >= 1; lvl--) {
    const pool = eligible(lvl);
    if (pool.length > 0) {
      const picked = pickWeighted(pool, performer);
      return { card: picked, recycled: false, softFlagged: isSoftFlagged(picked) };
    }
  }

  // Pool exhausted — try recycling (ignore usedCardIds)
  for (let lvl = chosenLevel; lvl >= 1; lvl--) {
    const pool = allCards.filter(c => passes(c, lvl));
    if (pool.length > 0) {
      const picked = pickWeighted(pool, performer);
      return { card: picked, recycled: true, softFlagged: isSoftFlagged(picked) };
    }
  }

  // If type was 'dare', try a truth at level 1 as last-resort fallback.
  // passes() checks card.type === 'dare' so cannot be used here — use safetyClear directly.
  if (type === 'dare') {
    const safeTruth = allCards.find(c => c.type === 'truth' && c.level === 1 && safetyClear(c));
    if (safeTruth) return { card: safeTruth, recycled: false, softFlagged: isSoftFlagged(safeTruth) };
  }

  return { card: null, recycled: false, softFlagged: false };
}

/**
 * Weighted random pick:
 * Cards that match a performer preference tag get 3× weight.
 * Everything else gets weight 1.
 */
function pickWeighted(pool, performer) {
  const prefs = performer.preferences || [];
  const weights = pool.map(c =>
    (c.tags || []).some(t => prefs.includes(t)) ? 3 : 1
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Returns true if performer and target have compatible orientations for an
 * orientation-relevant dare.
 */
function orientationCompatible(performer, target) {
  if (!target) return true;
  const po = performer.orientation || 'bi';
  const to = target.orientation || 'bi';
  if (po === 'bi' || to === 'bi') return true;
  // hetero: compatible if different genders; gay: compatible if same gender
  if (po === 'hetero' && to === 'hetero') return performer.gender !== target.gender;
  if (po === 'gay' && to === 'gay') return performer.gender === target.gender;
  return true;
}

module.exports = { selectCard };
