# Truth or Dare 2.0 — Build Spec voor Claude Code

> Handoff-document. Dit is de complete, geprioriteerde bouwopdracht voor v2.
> Lees ook `CLAUDE.md` (project bible) voor de volledige ontwerpredenen.
> Status van open beslissingen staat onderaan in **§ Open / nog te bevestigen**.

---

## 0. Doel & scope

Een geavanceerde, erotische, **kink-safe** Truth or Dare. Web-based.
- **Host** start een lokale Node.js server (1 zip downloaden, `start.bat` / `start.sh` runnen).
- **Spelers** joinen via browser op hun telefoon — geen app-installatie.
- **18+** age-gate bij laden.
- Twee views: speler (telefoon) en host (TV/computer).

**v1 staat al** (niet opnieuw bouwen, wel uitbreiden):
- `server.js` — Express + Socket.io: rooms, player state, card-filtering op limits, QR-code generatie.
- `public/index.html` — single-page client: age-gate, landing, host/join, player setup, lobby met QR, bottle-spin animatie, truth/dare card screen.
- `package.json` + `node_modules` — express, socket.io, qrcode.

**v2 = wat hieronder staat bouwen, bovenop v1.**

---

## 1. Architectuur-principes (niet afwijken zonder overleg)

1. **Alle game-logica server-side.** Clients zijn dom: ze tonen state en sturen intents (`chooseLevel`, `completeDare`, `useBreakSlot`, `buyPowerup`, `pickTarget`). De server valideert ALLES (limits, gender/orientation, body type, XP-toegang, coin-saldo).
2. **Eén bron van waarheid:** de server houdt per room een `GameState` object bij; broadcast deltas via Socket.io.
3. **Geen persistentie nodig.** XP/coins zijn per-sessie. State leeft in memory; server-restart = nieuwe game. (Rollover-gamemode voor coins is optioneel, later.)
4. **Filtering is een hard block.** Een dare wordt NOOIT getoond als die een limit, gender-regel, orientation of body type schendt. Dit is een veiligheidsgarantie, geen suggestie.
5. **Single-file client blijft** (`public/index.html`) tenzij het te groot wordt; dan pas opsplitsen. Host-view mag een aparte route/HTML zijn.
6. **Content-data los van code.** Dares in een apart `data/dares.json` (of `.js`), zodat content uitbreiden geen code-wijziging is.

---

## 2. Datamodellen

### 2.1 Player
```
Player {
  id, name, socketId,
  clothingItems: [string],        // gebruikt voor "kledingstuk uit" dares
  gender,                          // identity
  bodyType: 'penis' | 'vagina' | null,
  orientation: 'hetero' | 'bi' | 'gay',
  availableForAllCombos: bool,     // overrided gender/orientation matching als true
  limits: [limitTag],              // hard blocks
  consentCombos: [string],         // optionele expliciete combinatie-consents
  xp: int,
  coins: int,
  currentLevel: int,               // gekozen level deze beurt
  clearedLevels: [int],            // levels met >=3 voltooide dares
  daresCompletedPerLevel: { level: count },
  breakSlots: { total: 3, used: int, parkedDares: [dareId] },
  immunity: float,                 // 0..1, kans op auto-immuniteit
  activePowerups: [powerupId],
}
```

### 2.2 Dare / Truth card
```
Card {
  id,
  type: 'truth' | 'dare' | 'duel',
  level: 1..10,
  text,                            // NL of EN (zie open vraag taal)
  tags: [limitTag],                // welke limits deze card raakt -> filter
  genderRequired: [gender] | 'any',
  bodyTypeRelevant: bool,
  bodyTypeRequired: 'penis'|'vagina'|null,
  orientationMatters: bool,
  targetRequired: bool,            // heeft deze dare een doelwit nodig?
  duel: { kind: 'physical'|'funny'|'kinky', players: 'duo'|'multi' } | null,
}
```

### 2.3 GameState (per room)
```
GameState {
  roomCode, hostSocketId,
  phase: 'lobby'|'playing'|'duel'|'event'|'paused'|'ended',
  players: [Player],
  minStartLevel: int,              // host-keuze
  rouletteMode: 'off'|'exact'|'plus5'|'block',
  targetingMode: 'self'|'50-50'|'random',
  economyMode: 'schaars'|'gemiddeld'|'overvloedig',
  enabledPowerups: [powerupId],    // host-toggle
  enabledEvents: [eventId],        // host-toggle
  currentTurn: { playerId, card, target, status },
  turnOrder: [playerId],
  activeEvent: eventId | null,
}
```

---

## 3. Systemen om te bouwen (geprioriteerd)

### FASE 1 — Kern-progressie (eerst bouwen)
**1. Levels (1–10).** Host kiest `minStartLevel`. Speler kiest elke beurt eigen level (binnen toegang). Level-ladder = tabel in CLAUDE.md (§1). Een level is "cleared" na ≥3 voltooide dares op dat level.

**2. XP-systeem (per-sessie).**
- XP per voltooide dare: `level × 10`.
- XP nodig om volgend level te unlocken: `level × 40`.
- Duel-winst bonus: `+10` flat.
- **Beslis-regel (open):** is toegang tot level N = "genoeg XP" OF "vorige level cleared (3 dares)" OF beide? Standaard nu: **beide** (XP-drempel én vorige level cleared). Maak dit een config-flag `levelUnlock: 'xp'|'cleared'|'both'`.

**3. Coins (per-sessie).**
- Performer van een dare krijgt coins ("pineut zijn beloont je").
- `economyMode`: schaars (default) / gemiddeld / overvloedig.
- Schaars: voltooi dare = `level` coins; duel-winst = `5`.
- gemiddeld/overvloedig = multipliers (voorstel ×2 / ×4) — bevestigen.

**4. Filtering-engine (kritiek, veiligheids-feature).**
Selecteer een card alleen als ALLE waar zijn:
- `card.level` == gekozen level (of binnen roulette-regel).
- Geen overlap tussen `card.tags` en `target.limits` EN `performer.limits`.
- gender match: `card.genderRequired == 'any'` OF performer/target gender ∈ required (tenzij `availableForAllCombos`).
- orientation match indien `card.orientationMatters`.
- body type match indien `card.bodyTypeRelevant`.
Geen geldige card? → val terug naar lager level of truth.

### FASE 2 — Beurt-flow & targeting
**5. Turn flow** (zie CLAUDE.md §13):
1) speler kiest level → 2) systeem kiest card (gefilterd) → 3) target bepaald → 4) uitvoeren/duel → 5) XP+coins → 6) volgende beurt.

**6. Targeting-systeem.** `targetingMode`: self / 50-50 / random. Target mag NOOIT gekozen worden als card diens limits/gender/orientation schendt.

**7. Roulette-mode** voor level-keuze: off / exact / +5% kans op hoger / block (niet hoger dan gekozen).

**8. Break-slots (pauze-slots).** 3 per speler. Geparkeerde dare hoeft niet tijdens spel. Aan het eind: volle puntwaarde afgetrokken. 3 slots vol + weigeren → speler verliest + vooraf-afgesproken straf (host toont).

### FASE 3 — Power-ups & duels
**9. Power-ups.** Host togglet welke actief zijn. Kosten in coins (tabel CLAUDE.md §4): Skip 8, Immunity stone (2% auto-immuniteit) 12, Force swap 10, Double XP 6, Insight (preview dare-type) 4, Sabotage (-immuniteit ander) 15, Auto-win duel 20, Cooldown reset 7.

**10. Duel-systeem.** Getriggerd door duel-cards. Winnaar krijgt coins, verliezer doet de dare. Types: physical/funny/kinky. Duo of multiplayer (bv. "wie trekt het snelst schoenen uit"). **Resolutie (open):** voorstel = getimede fysieke challenge, host tikt winnaar aan. Auto-win power-up overschrijft.

### FASE 4 — Host-view & events
**11. Host functionaliteit** op TV/computer (`/host` route): muziek, animaties, dare-presentatie, game-pause, event-knoppen. Twee URLs: `http://HOST_IP:3000/host` (TV) en `http://HOST_IP:3000` (speler).

**12. Events / gamemodes** (host-getriggerd, niet default): Heat Mode (3 rondes extra kinky), Coin Rain, Penalty Night, Lucky One, Dark Round, Audience Vote. Plus de mass-dare / duel-time / mystery box / coin-storm triggers uit §9.

### FASE 5 — Gender/orientation setup & limits
**13. Player-setup uitbreiden:** gender, body type (penis/vagina), orientation (hetero/bi/gay), limits, optionele consent-combinaties, OF "always available for all combinations".

**14. Limits-tags (hard block).** Voorstel-lijst (CLAUDE.md §11): `fysiek · erotisch · kussen · kleden · voeten · bondage · spanking · exhibition · oraal · aanraking · humiliation · rollenspel · groep · samenwerking · water/ijs · blinddoek`. Lijst nog niet definitief.

---

## 4. Distributie
- Zip met `node_modules` inbegrepen.
- `start.bat` (Windows) + `start.sh` (Mac/Linux) die `node server.js` runnen en de host-URL + QR tonen.
- Server print host-IP zodat telefoons kunnen joinen op hetzelfde netwerk.

---

## 5. Tech-stack (vast)
- Node.js + Express + Socket.io + qrcode.
- Client in `public/index.html` (single file, geen build-step). Host-view mag `public/host.html`.
- Content in `data/dares.json` (los van code).
- UI in het Engels; dare-content NL/EN (taal-keuze nog te bevestigen).

---

## 6. Bouwvolgorde-advies voor Claude Code
1. Refactor `server.js`: introduceer `GameState` + per-room store.
2. Verplaats dares naar `data/dares.json` met het Card-schema (§2.2).
3. Bouw de **filtering-engine** als pure, geteste functie `selectCard(state, performer, target, level)` — dit is het hart en de veiligheidsgarantie. **Unit-test dit grondig.**
4. Levels + XP + coins (Fase 1).
5. Turn-flow + targeting + roulette + break-slots (Fase 2).
6. Power-ups + duels (Fase 3).
7. Host-view + events (Fase 4).
8. Setup-uitbreiding + definitieve limits-lijst (Fase 5).

> **Verplichte verificatiestap:** schrijf unit-tests voor `selectCard()` die bewijzen dat een dare met een tag in iemands limits NOOIT geselecteerd wordt, en dat gender/orientation/bodyType-mismatch altijd blokkeert. Dit is non-negotiable (kink-safe).

---

## 7. Open / nog te bevestigen (vraag Dylan vóór hardcoden)
1. **Level-definities** — 10-level ladder in CLAUDE.md §1 is voorstel, nog bevestigen.
2. **Duel-resolutie** — getimede challenge is voorstel, nog bevestigen.
3. **Limit-tags lijst** — voorstel hierboven, toevoegingen/verwijderingen open.
4. **XP/Coin-getallen** — voorstellen hierboven, nog niet bevestigd.
5. **Level-unlock-regel** — XP-drempel, 3-dares-cleared, of beide? (`levelUnlock` flag).
6. **Taal** van dare-content (NL / EN / beide).
7. **Coin economy-multipliers** voor gemiddeld/overvloedig.

---

*Bron van waarheid voor ontwerp blijft `CLAUDE.md`. Dit bestand vertaalt dat naar een bouwbare, geprioriteerde opdracht. Wijk niet af van de hard-block filtering zonder expliciete goedkeuring van Dylan.*
