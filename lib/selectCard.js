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

  function passes(card, level) {
    // Step 0: type filter — hard block
    if (card.type !== type) return false;

    // Step 1: level filter
    if (rouletteMode === 'block') {
      if (card.level > level) return false;
    } else {
      // 'off' and any unknown mode: exact match
      if (card.level !== level) return false;
    }

    // Step 2: performer limits — hard block
    if (card.tags && card.tags.some(t => (performer.limits || []).includes(t))) return false;

    // Step 3: target limits — hard block
    if (target && card.tags && card.tags.some(t => (target.limits || []).includes(t))) return false;

    // Step 4: gender filter
    // genderRequired: null = anyone; array = only those genders, unless availableForAllCombos
    if (card.genderRequired && card.genderRequired.length > 0) {
      if (!performer.availableForAllCombos && !card.genderRequired.includes(performer.gender)) {
        return false;
      }
    }

    // Step 5: targetRequired — card needs a second person
    if (card.targetRequired && !target) return false;

    // Step 5b: orientation filter (only when card explicitly requires it and target exists)
    if (card.orientationMatters && target) {
      if (!orientationCompatible(performer, target)) return false;
    }

    // Step 6: performer genitals — card lists what the performer must have
    if (card.performerGenitals && card.performerGenitals.length > 0) {
      const pg = performer.genitals || [];
      if (pg.includes('prefer-not')) return false;
      if (!card.performerGenitals.every(g => pg.includes(g))) return false;
    }

    // Step 6b: target genitals — card lists what the target must have
    if (target && card.targetGenitals && card.targetGenitals.length > 0) {
      const tg = target.genitals || [];
      if (tg.includes('prefer-not')) return false;
      if (!card.targetGenitals.every(g => tg.includes(g))) return false;
    }

    return true;
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

  // If type was 'dare', try a truth at level 1 as last-resort fallback
  if (type === 'dare') {
    const safeTruth = allCards.find(c => c.type === 'truth' && c.level === 1 && passes(c, 1));
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
