# Truth or Dare 2.0 — Build Spec & Handoff

> **Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · **Phase 4 = current target**
>
> This document is the living build order. `CLAUDE.md` is the design bible and always wins on conflicts.
> Open this file when building; `CLAUDE.md` supplies the design reasoning behind each decision.

---

## Phase status

| Phase | What | Status |
|-------|------|--------|
| 1 | Core engine — 72 cards, `selectCard()` safety, XP/coins, level picker, HUD, Railway deploy | ✅ Done |
| 2 | Turn flow — auto-advance, targeting, soft limits, break-slots, display host, end-game, restart | ✅ Done |
| 3 | Duels + power-ups + gender/body setup | ✅ Done |
| 4 | Host view enhancements + events / game-modes | Future |

---

## What is already built (read before touching)

### Files
| File | Purpose |
|------|---------|
| `server.js` | Express + Socket.io. All game logic. `advanceTurn()`, `selectCard()`, XP/coin attribution. |
| `lib/selectCard.js` | Pure filtering function. Returns `{ card, recycled, softFlagged }`. Heart of kink-safe guarantee. |
| `test/selectCard.test.js` | 25 unit tests — all must stay green. `node --test`. |
| `data/dares.json` | 72 cards (31 truths, 41 dares). Levels 1–9. Schema below. |
| `public/index.html` | Full single-page client. All screens. |
| `railway.toml` | Railway deploy config. |

### Key server events (Phase 1+2)
`create-room` · `join-room` · `player-setup` · `player-ready` · `set-game-config` · `start-game` · `choose-level` · `pick-truth-dare` · `complete-dare` · `use-break-slot` · `replay-parked-dare` · `respin-card` · `end-game` · `restart-game` · `next-turn` (emergency host-only)

### Card schema (v2)
```js
{
  id, type: 'truth'|'dare',
  level: 1–10, difficulty: 1–3,
  text: { en, nl },
  tags: [...],                    // limit-tag overlap = hard block
  genderRequired: null | [...],   // null = anyone
  bodyTypeRelevant: bool,
  bodyTypeRequired: null|'penis'|'vagina',
  orientationMatters: bool,
  targetRequired: bool,
}
```

### Player shape (v2)
```js
{
  id, name, emoji, clothingItems, preferences, softLimits,
  limits,           // PRIVATE — never broadcast
  ready, xp, coins, currentLevel, clearedLevels, daresCompletedPerLevel,
  usedCardIds,      // Set — PRIVATE
  breakSlots: { total:3, used, parkedDares: [{cardId,level,diff,text,xpPenalty}] },
  immunity,         // 0..1 float
  activePowerups,
  gender,           // currently null stub — Phase 3 makes it real
  bodyType,         // currently null stub — Phase 3 makes it real
  orientation: 'bi' // currently default — Phase 3 makes it real
}
```

### XP / Coin formulas (locked)
- XP per dare: `card.level × card.difficulty`
- Coins per dare: `Math.max(3, card.level × card.difficulty) × economyMultiplier`
- Economy mult: schaars ×1 · gemiddeld ×2 · overvloedig ×4
- Level unlock threshold: `(N−1) × 6` XP **AND** previous level cleared (≥3 dares)

---

## Phase 3 — Duels + Power-ups + Gender/body setup

### 3.1 Locked decisions going in

**Duel flow:**
- New card type: `type: 'duel'`. Always `targetRequired: true`.
- When duel card drawn: `currentTurn.phase = 'duel'`, broadcast.
- Both players (performer + target) see the duel screen. Everyone else sees the display screen.
- Host resolves via `resolve-duel` event: `{ code, winnerId }`.
- Winner gets coins (full `max(3,level×diff)×economy`). Loser gets nothing.
- XP **always** goes to the active turn-holder regardless of duel outcome (CLAUDE.md §7.5).
- `auto-win-duel` power-up: sets `currentTurn.duelAutoWinnerId = performerId` before broadcast; host sees it locked.

**Power-ups:**
- `buy-powerup` event: validates `player.coins >= cost`, deducts, pushes to `player.activePowerups`.
- `use-powerup` event: validates powerup is in activePowerups, applies effect, removes it.
- Power-up effects (all server-side):

| Power-up | Cost | Effect implementation |
|----------|-----:|-----------------------|
| skip | 8 | Skip current dare: no XP/coins, call `advanceTurn()` |
| immunity_stone | 12 | `player.immunity = Math.min(1, player.immunity + 0.02)` |
| force_swap | 10 | Re-run `pickTarget()` excluding current target; update `currentTurn.targetId` |
| double_xp | 6 | `currentTurn.doubleXp = true` (checked in `calcRewards`) |
| insight | 4 | `currentTurn.insightRevealed = true` (broadcasts card.type, not full card text) |
| sabotage | 15 | `target.immunity = Math.max(0, target.immunity - 0.05)` |
| auto_win_duel | 20 | `currentTurn.duelAutoWinnerId = performer.id` |

- Power-up shop: slide-up panel accessible from the card screen and level-picker screen (for the active player only).
- `buy-powerup` only allowed when `room.phase === 'game'` and player has enough coins.
- `use-powerup` only allowed when the powerup's timing is valid (see timing column).
- `enabledPowerups` array on room controls which are purchasable (host toggles in lobby).

**Immunity auto-roll:**
- At the start of each showing phase (`pick-truth-dare` resolves), before broadcasting: `if (Math.random() < performer.immunity) { currentTurn.phase = 'immune'; advanceTurn(); return; }`
- Toast to all: "[player] was immune this round! 🛡️"

**Gender / body type / orientation in setup:**
- Add three new fields to the setup form (after clothing, before preferences):
  - **Gender**: `male / female / non-binary / other / prefer not to say`
  - **Body type**: `penis / vagina / prefer not to say`
  - **Orientation**: `hetero / bi / gay / other`
  - Checkbox: `availableForAllCombos` ("I'm open for any combination")
- Send these from `player-setup` event: `gender, bodyType, orientation, availableForAllCombos`.
- Server stores them (replaces the null stubs). This activates the existing filtering steps in `selectCard()` that were already built but neutered by null defaults.

**Duel cards to add (15 new cards):**
Add to `data/dares.json`. Type `'duel'`, `targetRequired: true`. Spread across levels 1–9.
- Level 1–2: silly/fun (staring contest, thumb war, paper-scissors-rock best of 3)
- Level 3–4: flirty competition (who can flirt more convincingly, compliment battle)
- Level 5–6: physical/touchy (who can hold eye contact longest, who breaks first)
- Level 7–8: kinky challenge (whoever loses has to do X, intimate dare competition)
- Level 9: explicit duel

### 3.2 New server events

```
buy-powerup     { code, powerupId }           → buy from shop
use-powerup     { code, powerupId, targetId? } → activate (targetId for sabotage/force_swap)
resolve-duel    { code, winnerId }             → host-only, ends duel phase
```

### 3.3 New client screens / UI elements

- **`screen-duel`**: shows dare text, both player emojis/names, "duel in progress" state.
  - Host sees two big "🏆 [name] won" buttons to resolve.
  - Other players see display view (same card text, waiting for host).
- **Power-up shop panel** (`#powerup-shop`): slide-up overlay, shows enabled powerups with price/description, buy button, current coin balance.
  - Triggered by "🛒 Shop" button in HUD and on card screen.
- **HUD additions**: show active powerups as icons next to break-slot dots.

### 3.4 New tests to add

```
buy-powerup: insufficient coins → rejected
buy-powerup: disabled powerup  → rejected
use-powerup: not in activePowerups → rejected
double_xp: calcRewards returns 2× XP when doubleXp=true
immunity: Math.random mock at 0.0 → not immune; at 0.99 → immune
duel auto-win: duelAutoWinnerId set → winnerId locked to performer
```

---

## Phase 4 — Host-view enhancements & events (future)

- Dedicated host screen enhancements (music controls, game pause, presenter mode)
- Game-mode events: Heat Mode (3 rounds extra kinky), Coin Rain, Penalty Night, Lucky One, Dark Round
- Mass-dare / duel-time / mystery-box triggers

---

## Ideas backlog — future phases

These are scoped-out concepts, not yet scheduled. Each is self-contained enough to become its own phase.

### Expanded shop — buffs and actions
Push the coin economy further: multi-round buffs (e.g. "XP boost for 3 turns", "immunity shield for 2 rounds"), and mid-game action cards you spend coins on — force another player to redo a dare at a higher level, block someone from using a power-up for a round, steal coins. Separates "persistent buff" from "one-shot action" as distinct shop categories. Needs a buff-state tracker on the player and a broadcast of active buffs.

### Game memory — save, export, resume
Session snapshots: export a JSON of full game state (players, XP, coins, which card IDs have been played per player) so a session can be resumed another night without repeating cards. Same mechanism as card packages — export JSON, import next session. Needs a `POST /export` endpoint and an import flow in the lobby. `usedCardIds` per player is already the right structure; just needs serialisation.

### Dom/Sub edition
Dedicated game mode that layers D/s roles onto the existing structure. Doms get "directing" cards, subs get "receiving" cards. Role assignment (Dom/Sub/Switch) added to player setup; `selectCard()` gets a new filter step for `card.roleRequired`. Targeting logic respects role pairings. The full kink-safe guarantee (limits, consent, hard blocks) applies unchanged — the role only changes card flavour.

### Partner mode — targeted groups
For mixed parties where not everyone is comfortable playing with everyone. During setup, players mark their declared partners. For intimate/explicit cards (`card.level >= 7`), the targeting system only pairs you with your declared partners. You still play in the full group for lower-level cards. Needs a `player.partners: [playerId]` field and a targeting override in `pickTarget()` for high-level cards.

### Chaos mode — simultaneous active players
For large groups. Instead of one active player at a time, `Math.max(1, Math.floor(playerCount / 3))` players are active simultaneously (16 players → 4 active at once). Uses a queue instead of a round-robin index:

**Data model changes:**
- `room.chaosMode: bool` (host toggles in lobby)
- `room.activeSlots: number` = `floor(N/3)`, recalculated when players join/leave
- `room.turnQueue: [playerId, ...]` — ordered waiting list; all non-active players
- `room.activeturns: { [playerId]: currentTurn }` — one `currentTurn` object per active slot

**Flow:**
- Game start: first `activeSlots` players from `turnQueue` become active simultaneously; each gets their own `currentTurn` (phase `'choosing'`)
- When a player completes their dare: their slot frees up, they move to the **back** of `turnQueue`, and the **front** of `turnQueue` becomes the next active player
- No waiting for other active players — as soon as one finishes, the next starts independently
- Targeting: a currently-active player can never be a target (they're busy). `pickTarget()` draws only from `turnQueue`.

**Display view:** TV screen shows all active cards simultaneously (e.g. a 2-column grid for 4 active players). Each active player's phone shows only their own card + controls.

**Safety:** `selectCard()` per active slot runs identically to normal mode — full limit/gender/body/orientation filtering, one-at-a-time card selection per performer. No changes to the safety guarantee.

### Zero-install distribution — bundled Node.js binary
Right now the host needs Node.js installed. Eliminate that requirement by bundling a portable Node.js binary inside the zip, so the experience is: unzip → double-click → play.

**Preferred approach — portable Node.js in the zip:**
- Download the official Node.js "binary only" builds (a single `node.exe` for Windows, `node` for Mac, no installer):
  - Windows: `node-v22.x.x-win-x64.zip` → extract `node.exe` (~30 MB)
  - Mac: `node-v22.x.x-darwin-arm64.tar.gz` → extract `bin/node` (~35 MB)
- Place `node.exe` / `node` in the project root (git-ignored)
- `start.bat` changes from `node server.js` to `.\node.exe server.js`
- `start.sh` changes from `node server.js` to `./node server.js`
- Zip ships with: `node.exe`, `node`, `server.js`, `public/`, `data/`, `lib/`, `package.json`, `node_modules/` (or just the needed deps)
- No Node.js installation required on the host machine

**Alternative — `pkg` compiled single binary:**
- `pkg server.js --targets node22-win-x64,node22-macos-arm64` → produces `start.exe` + `start-macos`
- Pros: single file, no node_modules needed in zip. Cons: requires a build step, `pkg` as dev dependency, harder to debug.
- Recommended only if the portable approach causes issues (antivirus flagging, etc.)

**Note:** this is a distribution improvement only — no code changes to server logic, safety system, or tests.

---

## Architecture rules (never break)

1. All game logic server-side. Clients send intents, display state.
2. `selectCard()` is the safety guarantee — hard limits never leak.
3. `limits` array NEVER broadcast to clients (`roomPublicState` enforces this).
4. `node --test` must stay green before every commit.
5. Content (dares.json) separate from code.
6. No build step, no bundler, vanilla JS client.

---

## Open decisions (ask Dylan before hardcoding)

| # | Question | Status |
|---|----------|--------|
| 1 | Duel resolution timing — fixed countdown or host-taps-winner? | **Decided: host taps winner** |
| 2 | Power-up cooldowns — should some powerups have a cooldown per game? | Open |
| 3 | Duel forfeit — does the loser get a separate penalty dare, or is losing itself the consequence? | Open |
| 4 | Exact XP/coin numbers after playtest | Open — tune post-playtest |
| 5 | Final limit-tags list | Open — review with content after build |
