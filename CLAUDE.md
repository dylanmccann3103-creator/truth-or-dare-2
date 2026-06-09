# CLAUDE.md — Truth or Dare 2.0 (project bible)

> **Dit is het hoofdbestand en de bron-van-waarheid voor dit project.** Claude leest dit
> automatisch aan het begin van elke sessie en houdt zich hieraan. **Begin altijd hier.**
>
> **Documenten:**
> - **`CLAUDE.md`** (dit bestand) — *main*: ontwerp, architectuur-regels, conventies en de
>   veiligheidsgarantie. Altijd actief en leidend.
> - **`BUILD_SPEC.md`** — *handoff*: de geprioriteerde, gefaseerde bouwopdracht. Open dit zodra je
>   gaat bouwen; het is de uitvoerings-checklist die ónder dit bestand hangt.
>
> Bij **elk** conflict wint dit bestand. `BUILD_SPEC.md` overschrijft `CLAUDE.md` nooit — het
> vertaalt dit alleen naar een concrete bouwvolgorde. Verwijzingen naar de handoff staan inline
> bij de betreffende secties (§3, §8, §9).

---

## 1. Wat dit project is

Een geavanceerde, erotische, **kink-safe** Truth or Dare voor consenting adults (**18+**). Web-based.
De **host** start een lokale Node.js server (zip downloaden, `start.bat`/`start.sh` runnen). **Spelers**
joinen via de browser op hun telefoon — geen app-installatie. Twee views: speler (telefoon) en host
(TV/computer). Veiligheid en consent zijn ingebouwd, niet optioneel: harde limits, age-gate en
gefilterde content vormen de kern.

---

## 2. Hoe je het draait, bouwt en test

**Stack (vast):** Node.js + Express + Socket.io + qrcode. Geen build-step.

**Installeren:** dependencies zitten in de zip (`node_modules`). Vers project? `npm install`.

**Runnen:**
- `node server.js` — of `start.bat` (Windows) / `start.sh` (Mac/Linux).
- Server print het host-IP + QR-code zodat telefoons op hetzelfde netwerk kunnen joinen.
- Poort: **3000**.
  - Speler-view: `http://HOST_IP:3000`
  - Host-view: `http://HOST_IP:3000/host`

**Testen (verplicht):** unit-tests voor `selectCard()`. Gebruik de ingebouwde test runner
(`node --test`) zodat er geen build-step of extra dependency bijkomt. Zie §6 voor wat de tests
moeten bewijzen.

---

## 3. Architectuur-regels (niet afwijken zonder overleg)

1. **Alle game-logica server-side.** Clients zijn dom: ze tonen state en sturen *intents*
   (`chooseLevel`, `completeDare`, `useBreakSlot`, `buyPowerup`, `pickTarget`). De server
   valideert **alles** — limits, gender/orientation, body type, XP-toegang, coin-saldo.
2. **Eén bron van waarheid:** de server houdt per room een `GameState` bij en broadcast deltas
   via Socket.io. Clients leiden niks zelf af.
3. **Geen persistentie.** XP/coins zijn per-sessie, state leeft in memory. Server-restart = nieuwe
   game. (Coin-rollover is optioneel, later.)
4. **Content los van code.** Dares in `data/dares.json` volgens het Card-schema. Content uitbreiden
   mag nooit een code-wijziging vereisen.
5. **Single-file client** (`public/index.html`) blijft, tenzij het te groot wordt — pas dan
   opsplitsen. Host-view mag een aparte route/bestand zijn (`public/host.html`).

Datamodellen (`Player`, `Card`, `GameState`): zie **`BUILD_SPEC.md` §2**. Niet dupliceren — daar
staat de canonieke vorm.

---

## 4. Codeer-conventies

- **Geen build-step, geen framework, geen bundler.** Vanilla JS in de client.
- **Intents = werkwoorden** (`chooseLevel`, `completeDare`, …). Houd deze namen consistent tussen
  client en server.
- **Pure functies waar het kan**, met `selectCard()` als belangrijkste geteste, neveneffect-vrije
  functie.
- **UI-tekst in het Engels.** Dare-**content tweetalig**: elke card draagt NL én EN tekst
  (`text: { nl, en }`). Speler/host kiest de weergavetaal; data bevat beide.
- **Schema's één plek.** Wijzig je een datamodel, doe het op de canonieke plek (BUILD_SPEC §2) en
  niet ad hoc verspreid.

---

## 5. Niet-onderhandelbaar — de veiligheidsgarantie

> Dit is de reden dat het spel "kink-safe" heet. Verzwak dit **nooit** zonder expliciete goedkeuring
> van Dylan.

- **Filtering is een harde blokkade, geen suggestie.** Een dare wordt **nooit** getoond als die een
  limit, gender-regel, orientation of body type schendt — voor **zowel performer als target**.
- **`selectCard()` is het hart en de veiligheidsgarantie** en moet grondig unit-getest zijn (§6).
- **18+ age-gate** bij het laden: een **prominente, niet-wegklikbare modal** met expliciete
  18+-waarschuwing die actief bevestigd moet worden vóór toegang.
  *Accepted risk (publiek/Railway):* dit is een bevestigings-gate, geen identiteits-verificatie en
  client-side omzeilbaar. Bewust geaccepteerd voor nu; échte leeftijdsverificatie is een latere
  beslissing. Niet stilzwijgend negeren — dit staat hier expliciet genoteerd.
- Geen geldige card voor het gekozen level? → val terug naar een lager level of een truth. Nooit
  "maar dan toch deze".

---

## 6. Verplichte verificatie van `selectCard()`

Schrijf unit-tests die bewijzen dat:
1. een dare met een tag die in iemands `limits` zit **nooit** geselecteerd wordt;
2. een gender-mismatch altijd blokkeert (tenzij `availableForAllCombos`);
3. een orientation-mismatch blokkeert wanneer `card.orientationMatters`;
4. een body-type-mismatch blokkeert wanneer `card.bodyTypeRelevant`;
5. zowel performer- als target-limits gerespecteerd worden.

Dit is **non-negotiable**. Geen merge zonder groene tests.

---

## 7. Canonieke ontwerp-tabellen

### §7.1 Level-ladder (1–10) — *grotendeels bevestigd; level 7 nog open*
Elke speler kiest per beurt **zelf** truth of dare **én** het level (binnen toegang). Een level is
"cleared" na ≥3 voltooide dares. Hogere levels activeren steeds meer filtering (body type /
orientation). De speler kiest; de server filtert op limits/gender/bodytype — die zijn vooraf in de
setup opgegeven en worden uitsluitend backend afgehandeld.

| Lvl | Categorie | Aard van de dares |
|-----|-----------|-------------------|
| 1 | IJsbrekers | onschuldig, kennismaking, grappige truths — geen aanraking |
| 2 | Flirt | complimenten, lichte plagerij, oogcontact-spel |
| 3 | Lichte aanraking | hand vasthouden, knuffel, samen dansen |
| 4 | Kus (licht) | wang/hand/korte kus |
| 5 | Sensueel | langere kus, kleding-plagerij binnen kledingregels |
| 6 | Verleiding | massage, schoot, water/ijs-tag dares |
| 7 | Intiem | heftiger aanraking, kledingstuk uit (binnen limits) |
| 8 | Erotisch | explicietere dares — body-type-filtering actief |
| 9 | Expliciet | kinky categorieën (bondage/spanking-tags), alles binnen limits |
| 10 | **Extreme (met waarschuwing)** | meest intens — alleen wat álle limits/consents toelaten; toon een expliciete waarschuwing vóór het tonen van de card |

**Tag → level mapping (content-migratie):**
`general→1 · flirty→2 · body/physical→3 · mouth/clothing→4 · feet/oral→5 · intimate→6–7 ·
explicit→8–9 · extreme→10 (met waarschuwing)`.

> ✅ **Level 7 = `intimate` (intimate vult 6 én 7).** Geen gat meer in de ladder; selectCard
> hoeft niet terug te vallen voor level 7.

### §7.2 XP & coins (per-sessie) — *herzien, getallen nog te playtesten*

**XP per voltooide card:** `card.level × card.difficulty` (difficulty 1–3, zie §7.6).

**Unlock-drempel voor level N:** `N × 6`.
Dit getal = `level × median-difficulty(2) × minimaal-aantal-dares(3)`. Bij gemiddelde moeilijkheid
haal je het level dus precies in 3 dares; krijg je drie 1-pointers, dan heb je pech en moet je een
4e dare doen. Voorbeelden: level 1 → 6 XP, level 2 → 12, level 3 → 18, … (`N×6`).

- `levelUnlock` flag: `'xp' | 'cleared' | 'both'` — **`'both'`** (XP-drempel `N×6` **én** ≥3 dares
  op het vorige level cleared). ✅ bevestigd.
- Duel-winst: `+10` XP flat (voorlopig).

**Coins** (performer wordt beloond — "pineut zijn loont"):
- Per dare: `max(3, card.level + card.difficulty)` — de vloer van 3 zorgt dat early-game
  power-ups (goedkoopste = Insight 4) binnen ~2 dares bereikbaar zijn.
- `economyMode`: **schaars** (default, bovenstaande formule) · **gemiddeld** ×2 · **overvloedig** ×4.
- De host kan vóór de game starten kiezen voor een ruimere economy (meer coins per game). ✅
- Duel-winst: `5` coins (×economyMode).

> Getallen hierboven (XP-formule, coin-vloer, multipliers) zijn een coherent startpunt maar
> **moeten getuned worden via playtest**. Wijzig ze hier in CLAUDE.md, niet ad hoc in code.

### §7.3 Power-ups (kosten in coins) — host togglet welke actief zijn
| Power-up | Kosten | Effect |
|----------|-------:|--------|
| Skip | 8 | sla huidige dare over |
| Immunity stone | 12 | +2% auto-immuniteit |
| Force swap | 10 | wissel doelwit |
| Double XP | 6 | dubbele XP deze beurt |
| Insight | 4 | preview dare-type |
| Sabotage | 15 | verlaag immuniteit van ander |
| Auto-win duel | 20 | win duel automatisch |
| Cooldown reset | 7 | reset cooldown |

### §7.4 Limit-tags (hard block) — *English v1-lijst, werkend; definitieve review na build*
`general · flirty · clothing · body · physical · feet · mouth · oral · intimate · explicit`
(uitbreidbaar; finale lijst wordt samen met de content-review bevestigd ná de build.)

### §7.5 Turn-flow
1. speler kiest **truth of dare** + **level** → 2. systeem kiest gefilterde card van dat **type** en
level → 3. target bepaald (`targetingMode`: self / 50-50 / random) → 4. uitvoeren of duel →
5. XP + coins → 6. volgende beurt.

### §7.6 Card-schema & selectie — beslissingen (canon: BUILD_SPEC §2)
- **`type` is een harde filter.** `selectCard(allCards, type, performer, target, chosenLevel, …)`
  filtert eerst op `card.type === type` (truth/dare). Speler kiest het type; nooit een dare tonen
  als om een truth is gevraagd.
- **`difficulty`: 1–3.** Voelt iets als een 4? → dan hoort het een level hoger, niet difficulty 4.
- **`genderRequired`: array of `null`.** `null`/afwezig = iedereen. Anders een array van toegestane
  performer-genders. Geen `'any'`-sentinel-string meer. Match:
  `!card.genderRequired || card.genderRequired.includes(performer.gender) || performer.availableForAllCombos`.
- **`usedCardIds` per speler, niet per room.** Elke speler kan zo alle 72 cards (− limits) krijgen.
  Pool leeg? → recyclen + note tonen: *"Je hebt alle kaarten gehad — verzin gerust je eigen
  truth/dare."*
- **Preferences = zachte weging, geen filter.** Cards die een `preference`-tag raken krijgen een
  lichte voorkeur in de selectie (houdt het spel leuk), maar sluiten niets uit.
- **`host`-veld NIET hernoemen.** Code houdt `room.host` (v1). `hostSocketId` in BUILD_SPEC §2.3 is
  enkel een doc-alias — kosmetische rename loont de 4 call-sites breekrisico niet.

---

## 8. Huidige staat

**v1 staat (niet opnieuw bouwen, wel uitbreiden):**
- `server.js` — Express + Socket.io: rooms, player state, card-filtering op limits, QR-generatie.
- `public/index.html` — single-page client: age-gate, landing, host/join, setup, lobby+QR,
  bottle-spin, truth/dare-screen.
- `package.json` + `node_modules` — express, socket.io, qrcode.

**v2 = de fasen in `BUILD_SPEC.md` §3 / bouwvolgorde §6.** Volg die volgorde; dit bestand levert de
ontwerp-beslissingen die daarbij horen.

---

## 9. Open beslissingen (vraag Dylan vóór hardcoden)

Nog open:
1. **Duel-resolutie** — getimede fysieke challenge (host tikt winnaar) is voorstel (Fase 3).
2. **Definitieve XP/coin-tuning** — formules in §7.2 zijn een coherent startpunt; exacte getallen
   pas vast na playtest.
3. **Finale limit-tags lijst** — §7.4 English v1-lijst is werkend; review samen met content ná build.

**Reeds beslist** (niet meer vragen): `levelUnlock = 'both'` · dare-content tweetalig (NL+EN,
`text:{nl,en}`) · economy `gemiddeld ×2 / overvloedig ×4` · XP = `level×difficulty`, unlock = `N×6`
(§7.2) · coins = `max(3, level+difficulty)` · difficulty 1–3 · `genderRequired` = array|null ·
`selectCard` filtert op `type` · `usedCardIds` per speler + recycle-met-note · preferences = zachte
weging · `host`-veld niet hernoemen · level 10 = "Extreme" met waarschuwing · **level 7 = `intimate`
(6–7)** (§7.1, §7.6).

Tref je een nog-open beslissing? → vraag het, verzin niks zelf.
