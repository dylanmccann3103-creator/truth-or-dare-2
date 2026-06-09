'use strict';

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
  const baseCoins = Math.max(3, card.level * (card.difficulty || 1));
  const coinsEarned = coinsByEconomy(baseCoins, economyMode);

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

module.exports = { POWERUP_COSTS, coinsByEconomy, calcRewards, applyImmunity };
