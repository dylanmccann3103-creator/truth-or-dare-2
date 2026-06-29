'use strict';

const {
  GENDER_WILDCARD, isClothingRemovalCard, clothingTokenKind,
  stillOnItems, autoPickableItems, isStripStreakBlocked,
} = require('./gameHelpers');

/**
 * selectCard — the safety guarantee for Truth or Dare 2.0.
 *
 * Returns a single Card that passes ALL filters for the given performer + candidate
 * targets + level, or null if no safe card exists. Pure: never mutates players or
 * clothing state.
 *
 * @param {object[]} allCards    - card array
 * @param {string}   type        - 'truth' | 'dare' | 'duel'
 * @param {object}   performer   - active Player (PA)
 * @param {object|object[]|null} targets - a single target (legacy) OR an array of
 *        candidate targets (all connected inactive players except PA). For a
 *        targetRequired card the card is eligible only if AT LEAST ONE candidate
 *        passes the target-side checks; the chosen card is returned with its list of
 *        valid targets so the caller can draw the actual PB afterwards.
 * @param {number}   chosenLevel - level the performer chose this turn
 * @param {Set}      usedCardIds - Set of card ids already used by this player
 * @param {object}   [options]
 * @param {string}   [options.rouletteMode] - 'off'|'block'
 * @returns {{ card: object|null, recycled: boolean, softFlagged: boolean, validTargets: object[] }}
 */
function selectCard(allCards, type, performer, targets, chosenLevel, usedCardIds, options = {}) {
  const { rouletteMode = 'off' } = options;

  // Two ways to pass the second person:
  //  - an ARRAY of candidate targets (new model): only relevant to targetRequired cards;
  //    the card is eligible if AT LEAST ONE candidate passes the target-side checks.
  //  - a SINGLE target object (legacy): a committed target, validated on EVERY card.
  const isCandidateArray = Array.isArray(targets);
  const candidates    = isCandidateArray ? targets.filter(Boolean) : [];
  const legacyTarget  = (!isCandidateArray && targets) ? targets : null;

  const performerBlockedByStreak = isStripStreakBlocked(performer);

  // Does `cand` pass the TARGET-side checks for this card? (limits, orientation,
  // target genitals, and — for {{ct}} cards — clothing eligibility on the target.)
  function targetPasses(card, cand) {
    if (!cand) return false;
    if (card.tags && card.tags.some(t => (cand.limits || []).includes(t))) return false;
    if (card.orientationMatters && !orientationCompatible(performer, cand)) return false;
    if (card.targetGenitals && card.targetGenitals.length > 0) {
      const tg = cand.genitals || [];
      if (!card.targetGenitals.some(g => tg.includes(g))) return false;
    }
    // {{ct}} cards auto-strip the TARGET — gate on the target's auto-pickable wardrobe
    // (underwear excluded below level 6) + their strip streak.
    if (isClothingRemovalCard(card) && clothingTokenKind(card) === 'ct') {
      if (isStripStreakBlocked(cand)) return false;
      if (autoPickableItems(cand.clothingItems, card.level).length === 0) return false;
    }
    return true;
  }

  // The valid targets for this card. Legacy: the single committed target must pass on
  // EVERY card. Array model: only targetRequired cards draw from the candidate pool.
  function validTargetsFor(card) {
    if (legacyTarget) return targetPasses(card, legacyTarget) ? [legacyTarget] : [];
    if (!card.targetRequired) return [];
    return candidates.filter(c => targetPasses(card, c));
  }

  // Does this card satisfy its target requirement?
  function targetGateOk(card) {
    if (legacyTarget) {
      // A committed target is validated regardless of targetRequired (safety: never show
      // a card that violates the present target's limits/orientation/genitals).
      return targetPasses(card, legacyTarget);
    }
    if (card.targetRequired) return validTargetsFor(card).length > 0;
    return true;
  }

  function passes(card, level) {
    // Step 0: type filter — hard block
    if (card.type !== type) return false;

    // Step 1: level filter
    if (rouletteMode === 'block') {
      if (card.level > level) return false;
    } else {
      if (card.level !== level) return false;
    }

    // Step 2: performer limits — hard block
    if (card.tags && card.tags.some(t => (performer.limits || []).includes(t))) return false;

    // Step 3: gender filter.
    // genderRequired: null = anyone; array = only those genders, unless the performer
    // is availableForAllCombos OR uses the gender wildcard (see GENDER_WILDCARD).
    if (card.genderRequired && card.genderRequired.length > 0) {
      const genderOk =
        performer.availableForAllCombos ||
        performer.gender === GENDER_WILDCARD ||           // prefer_not_to_say matches any
        card.genderRequired.includes(performer.gender);
      if (!genderOk) return false;
    }

    // Step 4: performer genitals — must have AT LEAST ONE listed body part.
    if (card.performerGenitals && card.performerGenitals.length > 0) {
      const pg = performer.genitals || [];
      if (!card.performerGenitals.some(g => pg.includes(g))) return false;
    }

    // Step 5: clothing-removal gating for {{c}} / player-choice cards (performer strips).
    // {{ct}} cards strip the target and are gated in targetPasses() instead.
    // Cards serve at their authored level (old system); the only constraint is that the
    // performer has something to take off — and the system won't auto-pick underwear
    // below level 6 (player-choice cards may still remove anything).
    if (isClothingRemovalCard(card) && clothingTokenKind(card) !== 'ct') {
      if (performerBlockedByStreak) return false;                       // pacing guardrail
      const removable = clothingTokenKind(card) === 'c'
        ? autoPickableItems(performer.clothingItems, card.level)        // {{c}} auto-pick
        : stillOnItems(performer.clothingItems);                        // player-choice
      if (removable.length === 0) return false;
    }

    // Step 6: target gate — targetRequired needs a valid target; a committed legacy
    // target must always pass its own limits/orientation/genitals checks.
    if (!targetGateOk(card)) return false;

    return true;
  }

  // Soft-limit detection: does NOT block, just flags the selected card.
  function isSoftFlagged(card) {
    if (!card) return false;
    const tags = card.tags || [];
    if (tags.some(t => (performer.softLimits || []).includes(t))) return true;
    // Flag when every valid target would hit a soft limit (no soft-free target left).
    const vts = validTargetsFor(card);
    return vts.length > 0 && vts.every(t => tags.some(tag => (t.softLimits || []).includes(tag)));
  }

  function eligible(level) {
    return allCards.filter(c => !usedCardIds.has(c.id) && passes(c, level));
  }

  function result(card, recycled) {
    return {
      card,
      recycled,
      softFlagged: isSoftFlagged(card),
      validTargets: card ? validTargetsFor(card) : [],
    };
  }

  // Fallback chain: chosenLevel → chosenLevel-1 → … → 1
  for (let lvl = chosenLevel; lvl >= 1; lvl--) {
    const pool = eligible(lvl);
    if (pool.length > 0) return result(pickWeighted(pool, performer), false);
  }

  // Pool exhausted — recycle (ignore usedCardIds).
  for (let lvl = chosenLevel; lvl >= 1; lvl--) {
    const pool = allCards.filter(c => passes(c, lvl));
    if (pool.length > 0) return result(pickWeighted(pool, performer), true);
  }

  // Last resort for a dare request: a safe level-1 truth.
  if (type === 'dare') {
    const safeTruth = allCards.find(c => c.type === 'truth' && c.level === 1 && passes(c, 1));
    if (safeTruth) return result(safeTruth, false);
  }

  return { card: null, recycled: false, softFlagged: false, validTargets: [] };
}

/**
 * Weighted random pick: cards matching a performer preference tag get 3× weight.
 */
function pickWeighted(pool, performer) {
  const prefs = performer.preferences || [];
  const weights = pool.map(c => ((c.tags || []).some(t => prefs.includes(t)) ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * True if performer and target have compatible orientations for an
 * orientation-relevant dare.
 */
function orientationCompatible(performer, target) {
  if (!target) return true;
  const po = performer.orientation || 'bi';
  const to = target.orientation || 'bi';
  if (po === 'bi' || to === 'bi') return true;
  if (po === 'hetero' && to === 'hetero') return performer.gender !== target.gender;
  if (po === 'gay' && to === 'gay') return performer.gender === target.gender;
  return true;
}

module.exports = { selectCard };
