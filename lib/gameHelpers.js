'use strict';

// ─── Body / identity vocabulary ────────────────────────────────────────────────
// Genitals are an independent body-part filter, separate from gender.
// Fixed vocabulary — oral acts use the `oral` TAG, there is deliberately no "mouth".
const GENITAL_VOCAB = ['penis', 'vagina', 'breasts', 'anus'];

// Base genders. Packs may declare extra genders (see mergeGenders); nothing here is
// hardcoded into the filter — genderRequired matches by string against whatever exists.
const BASE_GENDERS = [
  { id: 'male',               label: 'Male' },
  { id: 'female',             label: 'Female' },
  { id: 'prefer_not_to_say',  label: 'Prefer not to say' },
];

// ── prefer_not_to_say ───────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for the "don't gate me on gender" identity. A player with
// this gender matches ANY genderRequired card (so they're never excluded from
// gendered content); body-specific gating is left to genitals instead. Change here
// to alter that behaviour everywhere.
const GENDER_WILDCARD = 'prefer_not_to_say';

/**
 * Merge custom pack genders into a base list, de-duplicating by id. Pure.
 * @param {Array<{id,label}>} base
 * @param {Array<{id,label}>} packGenders
 */
function mergeGenders(base, packGenders) {
  const out = (base || []).map(g => ({ id: g.id, label: g.label || g.id }));
  const seen = new Set(out.map(g => g.id));
  for (const g of (packGenders || [])) {
    if (g && typeof g.id === 'string' && g.id && !seen.has(g.id)) {
      out.push({ id: g.id, label: (typeof g.label === 'string' && g.label) ? g.label : g.id });
      seen.add(g.id);
    }
  }
  return out;
}

// ─── Clothing: category table, pacing, weighted removal ─────────────────────────
// Every clothing item maps to ONE category. Categories give the auto-pick weight (the
// system tends to take the least-intimate item first) and tag underwear specially.
// LEVELING NOTE: clothing cards serve at whatever level they're authored at (old
// system). The ONLY level rule is that the SYSTEM may not AUTO-force underwear off
// below UNDERWEAR_AUTO_MIN_LEVEL — a player may always choose to remove it earlier.
const CLOTHING_CATEGORY_META = {
  headwear:  { weight: 3 },
  scarf:     { weight: 3 },
  socks:     { weight: 3 },
  upper:     { weight: 2 },
  pants:     { weight: 2 },
  underwear: { weight: 1 },
};

// Below this level the system cannot auto-pick underwear ({{c}}/{{ct}}); player-choice
// removal of underwear is allowed at any level (it's the player's own decision).
const UNDERWEAR_AUTO_MIN_LEVEL = 6;

/**
 * Map a clothing item ({key,label,value}) to its category, or null if unmappable.
 * Keys come from the client's CLOTHING_SLOTS (head_*, neck_*, jacket_*, body_*,
 * underwear_*, legs_*, foot_left_*, foot_right_*) plus free-form extra_* items.
 */
function clothingCategory(item) {
  if (!item) return null;
  const key = String(item.key || '').toLowerCase();
  if (key.startsWith('foot')) return 'socks';
  const slot = key.split('_')[0];
  switch (slot) {
    case 'head':      return 'headwear';
    case 'neck':      return 'scarf';
    case 'jacket':    return 'upper';
    case 'body':      return 'upper';
    case 'underwear': return 'underwear';
    case 'legs':      return 'pants';
    default: break;
  }
  // Fallback: infer from free-text value/label (covers custom extra_* items).
  const txt = `${item.value || ''} ${item.label || ''}`.toLowerCase();
  if (/\b(bra|panties|panty|boxers?|briefs?|string|thong|lingerie|bodysuit)\b/.test(txt)) return 'underwear';
  if (/\b(socks?|shoes?|sandals?|slippers?)\b/.test(txt)) return 'socks';
  if (/\b(hat|cap|beanie|headband)\b/.test(txt)) return 'headwear';
  if (/\b(scarf|necklace|choker|tie)\b/.test(txt)) return 'scarf';
  if (/\b(pants?|shorts?|skirt|leggings?|jeans|trousers)\b/.test(txt)) return 'pants';
  if (/\b(shirt|t-?shirt|sweater|hoodie|jacket|cardigan|coat|blouse|top|vest|tank)\b/.test(txt)) return 'upper';
  return null;
}

// A card is a clothing-removal card iff it carries the `clothing` tag (editor checkbox).
function isClothingRemovalCard(card) {
  return !!card && Array.isArray(card.tags) && card.tags.includes('clothing');
}

// Collect every language string of a card's text (string or {nl,en,...}).
function cardTextValues(card) {
  const t = card && card.text;
  if (!t) return [];
  if (typeof t === 'string') return [t];
  return Object.values(t).filter(v => typeof v === 'string');
}

/**
 * Which clothing token a card uses: 'ct' (target's clothing), 'c' (performer's
 * clothing / player-choice auto), or null. A card uses {{c}} OR {{ct}}, not both.
 */
function clothingTokenKind(card) {
  const texts = cardTextValues(card);
  if (texts.some(s => s.includes('{{ct}}'))) return 'ct';
  if (texts.some(s => s.includes('{{c}}')))  return 'c';
  return null;
}

/** All still-on (not yet removed) clothing items. Pure. */
function stillOnItems(items) {
  return (items || []).filter(it => it && !it.removed);
}

/**
 * Items the SYSTEM may auto-pick to remove for a card at `level`: every still-on item,
 * minus underwear when level < UNDERWEAR_AUTO_MIN_LEVEL. Pure.
 */
function autoPickableItems(items, level) {
  return stillOnItems(items).filter(it =>
    !(clothingCategory(it) === 'underwear' && level < UNDERWEAR_AUTO_MIN_LEVEL)
  );
}

/** Weighted-random pick from a list of clothing items (category weights 3/2/1). */
function pickClothingItem(eligibleItems, rng = Math.random) {
  if (!eligibleItems || eligibleItems.length === 0) return null;
  const weights = eligibleItems.map(it => CLOTHING_CATEGORY_META[clothingCategory(it)]?.weight || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < eligibleItems.length; i++) {
    r -= weights[i];
    if (r <= 0) return eligibleItems[i];
  }
  return eligibleItems[eligibleItems.length - 1];
}

// A player is strip-streak-blocked once they've completed 2 clothing-removal cards in
// a row — the next draw must be non-clothing (see selectCard), then the streak resets.
function isStripStreakBlocked(player) {
  return (player && player.clothingStreak ? player.clothingStreak : 0) >= 2;
}

/**
 * Substitute resolved tokens into a card's text (string or {nl,en,...}).
 * {{PA}} active player, {{PB}} target, {{c}} performer garment, {{ct}} target garment.
 * Missing subs are left untouched so authoring mistakes are visible, not silently blank.
 */
function renderTokens(text, subs = {}) {
  const apply = (s) => {
    if (typeof s !== 'string') return s;
    let out = s;
    if (subs.paName != null) out = out.replace(/\{\{PA\}\}/g, subs.paName);
    if (subs.pbName != null) out = out.replace(/\{\{PB\}\}/g, subs.pbName);
    if (subs.ctLabel != null) out = out.replace(/\{\{ct\}\}/g, subs.ctLabel);
    if (subs.cLabel != null) out = out.replace(/\{\{c\}\}/g, subs.cLabel);
    return out;
  };
  if (text && typeof text === 'object') {
    const out = {};
    for (const k of Object.keys(text)) out[k] = apply(text[k]);
    return out;
  }
  return apply(text);
}

/**
 * Weighted target draw from a card's already-validated valid-target list. Pure.
 * Hard limits were excluded upstream (selectCard). Here we bias the draw:
 *   preference matches a card tag -> weight 3 (toward what they like)
 *   neutral                       -> weight 2
 *   soft limit matches a card tag -> weight 1 (away from soft limits)
 * (Spec floor is "soft -> 1, otherwise 1"; neutral is lifted to 2 so soft genuinely
 *  down-weights, honouring the stated intent "away from their soft limits".)
 */
function selectTarget(validTargets, card, rng = Math.random) {
  if (!validTargets || validTargets.length === 0) return null;
  if (validTargets.length === 1) return validTargets[0];
  const tags = (card && card.tags) || [];
  const weightFor = (p) => {
    if ((p.preferences || []).some(t => tags.includes(t))) return 3;
    if ((p.softLimits  || []).some(t => tags.includes(t))) return 1;
    return 2;
  };
  const weights = validTargets.map(weightFor);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < validTargets.length; i++) {
    r -= weights[i];
    if (r <= 0) return validTargets[i];
  }
  return validTargets[validTargets.length - 1];
}

const POWERUP_COSTS = {
  skip: 8,
  immunity_stone: 12,
  force_swap: 10,
  double_xp: 6,
  insight: 4,
  sabotage: 15,
  auto_win_duel: 20,
};

function coinsByEconomy(base, mode) {
  if (mode === 'gemiddeld')   return base * 2;
  if (mode === 'overvloedig') return base * 4;
  return base;
}

/**
 * Calculate XP and coin rewards for a completed card.
 * @param {object} card
 * @param {{ type: 'solo'|'duel', performerId?: string, winnerId?: string }} attribution
 * @param {string} economyMode
 * @param {boolean} doubleXp - whether double_xp powerup is active
 * @returns {{ xpEarned: number, coinRecipients: Array<{id, coins}> }}
 */
function calcRewards(card, attribution, economyMode, doubleXp = false) {
  const xpBase    = card.level * (card.difficulty || 1);
  const xpEarned  = doubleXp ? xpBase * 2 : xpBase;
  const coinsEarned = Math.max(3, coinsByEconomy(card.level * (card.difficulty || 1), economyMode));

  let coinRecipients = [];
  if (attribution) {
    if (attribution.type === 'solo') {
      coinRecipients = [{ id: attribution.performerId, coins: coinsEarned }];
    } else if (attribution.type === 'duel' && attribution.winnerId) {
      coinRecipients = [{ id: attribution.winnerId, coins: coinsEarned }];
    }
  }
  return { xpEarned, coinRecipients };
}

/**
 * Roll immunity: returns true if performer is immune this round.
 * Caller must have already checked performer.immunity > 0.
 */
function applyImmunity(performer) {
  return performer.immunity > 0 && Math.random() < performer.immunity;
}

module.exports = {
  POWERUP_COSTS, coinsByEconomy, calcRewards, applyImmunity,
  GENITAL_VOCAB, BASE_GENDERS, GENDER_WILDCARD, mergeGenders,
  CLOTHING_CATEGORY_META, UNDERWEAR_AUTO_MIN_LEVEL, clothingCategory,
  isClothingRemovalCard, clothingTokenKind, stillOnItems, autoPickableItems,
  pickClothingItem, isStripStreakBlocked, renderTokens, selectTarget,
};
