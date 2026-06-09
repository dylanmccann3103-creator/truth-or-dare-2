# Phase 3 Goal Prompt

> Paste the text below (everything after the horizontal rule) as your first message in a new session.
> It is self-contained — no prior context needed.

---

I'm building Truth or Dare 2.0 — an adult kink-safe party game (18+). Phases 1 and 2 are fully complete and committed to GitHub. I need you to implement Phase 3.

## Start by reading these two files in full

1. `CLAUDE.md` — the design bible. Architecture rules, safety guarantees, all locked decisions. **This wins every conflict.**
2. `BUILD_SPEC.md` — the build spec. Phase 3 is fully defined starting at "## Phase 3". The current state of the codebase is documented at the top.

Do NOT start implementing until you've read both files. If anything in BUILD_SPEC.md §3 seems underspecified, check CLAUDE.md before asking me.

## What Phase 3 adds

Three tightly related feature sets. Implement in this order:

### A. Gender / body type / orientation in setup (unblocks all filtering)

The `selectCard()` filtering for orientation and body type is already written and tested, but is currently neutered because `player.gender`, `player.bodyType`, and `player.orientation` are null/default stubs. Phase 3 makes these real.

1. In `public/index.html` setup screen: add three new field groups after the clothing section, before preferences:
   - **Gender**: pill-buttons `male / female / non-binary / other / prefer not to say`
   - **Body type**: pill-buttons `penis / vagina / prefer not to say`
   - **Orientation**: pill-buttons `hetero / bi / gay / other`
   - A single checkbox: "I'm flexible — any combination works for me" → `availableForAllCombos: true`
2. Include these in the `player-setup` socket event payload.
3. In `server.js`: store `gender`, `bodyType`, `orientation`, `availableForAllCombos` on the player. Replace the null stubs.
4. These values MUST be included in `roomPublicState` (they're safe to broadcast and used for filtering).

**Verification**: after this, a `bodyTypeRequired: 'vagina'` card should never reach a `penis` player.

### B. Duel system

New card type: `type: 'duel'`. Always `targetRequired: true`. Add 15 duel cards to `data/dares.json` following the existing card schema. Spread across levels 1–9:
- Levels 1–2: silly/fun (staring contest, thumb war, paper-scissors-rock best of 3, most creative compliment battle)
- Levels 3–4: flirty competition (convince each other you're the better flirt, pick-up line battle, who holds eye contact longest)
- Levels 5–6: physical/touchy (who pulls the other closer first, back-to-back sitting, first to break a straight face)
- Levels 7–8: kinky challenge (whoever loses has to do X intimate forfeit, endurance game)
- Level 9: explicit duel dare

Cards must include both `text.en` and `text.nl`. Use `tags` matching §7.4 of CLAUDE.md.

**Server-side duel flow:**

When `pick-truth-dare` draws a duel card:
- Set `currentTurn.phase = 'duel'`
- `currentTurn.attribution = { type: 'duel', performerId, targetId }` (so calcRewards knows who gets what)
- Broadcast room state

New socket event `resolve-duel { code, winnerId }` (host-only):
- Validate: room.phase === 'game', currentTurn.phase === 'duel', room.host === socket.id
- If `currentTurn.duelAutoWinnerId` is set, ignore winnerId and use that instead
- Winner gets coins: `Math.max(3, card.level × card.difficulty) × economyMult`
- XP always goes to active turn-holder (performerId), even if they lost
- Update `performer.daresCompletedPerLevel`, `clearedLevels`, level XP check
- Call `advanceTurn(room)` after 1500ms

**Client duel screen** (`screen-duel` or reuse display routing):
- Show dare text large, both player emojis + names, a "⚔️ Duel in progress" banner
- The **host** (display mode) sees two big buttons: "🏆 [Performer name] won" and "🏆 [Target name] won" → emits `resolve-duel { code, winnerId }`
- All other players (and non-display phones) see the display screen with the card text and "Waiting for host to call it..."
- The two dueling players also see the dare text + "You're in a duel!" but no resolve buttons

Routing in `handleRoomState`: if `currentTurn.phase === 'duel'`, show duel view. Host sees resolve buttons; everyone else sees display.

### C. Power-ups

The 7 purchasable power-ups (skip the Cooldown Reset for Phase 3 — no cooldowns exist yet):

| ID | Cost | Effect |
|----|-----:|--------|
| `skip` | 8 | Skip current dare, no XP/coins, `advanceTurn()` |
| `immunity_stone` | 12 | `player.immunity = Math.min(1, player.immunity + 0.02)` |
| `force_swap` | 10 | Re-run `pickTarget()` excluding current target, update `currentTurn.targetId` |
| `double_xp` | 6 | `currentTurn.doubleXp = true` — checked in `calcRewards`, doubles XP |
| `insight` | 4 | `currentTurn.insightRevealed = true` — broadcasts card type (truth/dare/duel) before full draw |
| `sabotage` | 15 | Target another player: `target.immunity = Math.max(0, target.immunity - 0.05)` |
| `auto_win_duel` | 20 | `currentTurn.duelAutoWinnerId = performer.id` (locks duel outcome) |

**Server events:**

`buy-powerup { code, powerupId }`:
- Validate: room.phase === 'game', powerupId in room.enabledPowerups, player.coins >= POWERUP_COSTS[powerupId]
- Deduct coins, push powerupId to `player.activePowerups` array (allow multiples)
- Broadcast room state

`use-powerup { code, powerupId, targetId? }`:
- Validate: powerupId in player.activePowerups
- Apply effect (see table above). `sabotage` and `force_swap` require `targetId`.
- Remove one instance from activePowerups
- Broadcast room state

**Immunity auto-roll** (already exists as a stub — wire it up now):
- In `pick-truth-dare` handler, after choosing the performer, before setting `phase='showing'`:
  ```js
  if (performer.immunity > 0 && Math.random() < performer.immunity) {
    io.to(room.code).emit('toast', { msg: `🛡️ ${performer.name} is immune this round!` });
    return advanceTurn(room);
  }
  ```

**Lobby config**: `set-game-config` already handles `enabledPowerups` array (or add it if missing). Host can toggle power-ups on/off before game starts.

**Client power-up shop panel** (`#powerup-shop`):
- Slide-up overlay (same style as the soft-limit respin prompt or existing modal pattern)
- Shows all `room.enabledPowerups` with name, description, cost (🪙 N coins), and a "Buy" button
- "Buy" greys out if `myCoins < cost`; emits `buy-powerup`
- Active powerups shown in the HUD as small icons next to the break-slot dots
- "🛒" shop button in HUD bar (visible during game for all players)
- After buying, the powerup appears in "Your powerups" section with a "Use" button
- `use-powerup` button timing:
  - `skip`, `park`, `respin`, `insight`, `double_xp`: active player's card/level screen only
  - `force_swap`: active player's card screen, only when `currentTurn.targetId` is set
  - `sabotage`, `immunity_stone`: any time during the game (open shop and use)
  - `auto_win_duel`: before or during a duel phase

## New tests to add to `test/selectCard.test.js`

```
Test 18: buy-powerup insufficient coins → server rejects (unit test the validation logic)
Test 19: double_xp flag — calcRewards returns 2× the normal XP amount
Test 20: immunity at 100% → performer always immune (Math.random mock to 0.0)
Test 21: immunity at 0% → performer never immune
Test 22: duel auto-win — duelAutoWinnerId === performerId overrides any passed winnerId
```

Tests 18–22 can live as pure unit tests of the helper functions (extract `calcRewards` and `applyImmunity` if needed).

## Architecture rules (non-negotiable — do not touch)

- `selectCard()` safety guarantee: hard limits never show. Tests must stay green.
- ALL game logic server-side. Clients send intents, server validates.
- `limits` array never broadcast to clients.
- `node --test` must pass before every commit.
- No build step, no bundler, vanilla JS.
- `CLAUDE.md` wins all conflicts.

## Open questions (ask me before hardcoding)

Two things are still open for Phase 3:
1. **Duel forfeit**: when someone loses a duel, is the consequence just "no coins"? Or should the server generate a small forfeit dare for the loser? **Ask me before implementing a forfeit system.**
2. **Power-up cooldowns**: should any power-up be limited to once-per-game (e.g. auto_win_duel)? **Ask me before adding cooldown logic.**

Everything else in Phase 3 is decided. If you find a conflict between BUILD_SPEC.md and CLAUDE.md, CLAUDE.md wins — but note the conflict for me.

## When you're done

1. Run `node --test` — all tests must be green (target: 22+)
2. Run `node --check server.js` — no syntax errors
3. Start the server with `node server.js` and test the golden path: create room → 2 players join → play through a duel → buy and use a power-up → verify coins deducted + immunity roll
4. Commit with a clear message

GitHub: https://github.com/dylanmccann3103-creator/truth-or-dare-2
