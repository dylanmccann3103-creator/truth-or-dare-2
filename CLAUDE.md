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
`general→1 · flirty→2 · body/physical→3 · kissing/clothing→4 · feet/speaking→5 · intimate→6–7 ·
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
- Per dare: `max(3, card.level × card.difficulty × economyMult)` — coins volgen dus de XP-waarde
  (`level × difficulty`), geschaald met de economy, met een **vloer van 3**. Die vloer zorgt dat
  early-game power-ups (goedkoopste = Insight 4) binnen ~2 dares bereikbaar blijven.
- `economyMult`: **schaars** ×1 (default) · **gemiddeld** ×2 · **overvloedig** ×4.
- De host kan vóór de game starten kiezen voor een ruimere economy (meer coins per game). ✅
- Duel-winst: `5` coins (×economyMult), tenzij de duel-card een eigen waarde draagt.

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
`general · flirty · clothing · body · physical · feet · kissing · speaking · oral · intimate · explicit · anal · bondage · toy · public · exposure`

Tag-omschrijvingen (voor speler-setup UI én selectCard-filtering):
| Tag | Blokkeert |
|-----|-----------|
| `general` | algemene/neutrale dares |
| `flirty` | flirterige, complimenteuze dares |
| `clothing` | kleding uittrekken / stripping |
| `body` | lichaamsgericht (aanraking, massage) |
| `physical` | fysieke uitdagingen |
| `feet` | voeten-gerelateerd |
| `kissing` | kussen (wang, mond, lichaam — niet-seksueel) |
| `speaking` | iets hardop zeggen: fluisteren, complimenten, fantasie beschrijven |
| `oral` | orale seks (pijpen, beffen) |
| `intimate` | intieme aanraking (niet-seksueel) |
| `explicit` | seksuele handelingen |
| `anal` | anale stimulatie (plug, vinger, tong) |
| `bondage` | vastbinden, halsband/riem, BDSM-elementen |
| `toy` | gebruik van seksspeeltjes |
| `public` | semi-publieke setting (auto, balkon, etc.) |
| `exposure` | blootstelling buiten het spel: nudes sturen, contact iets bekennen, selfies posten, etc. |

(Finale lijst wordt samen met de content-review bevestigd ná de build.)

### §7.5 Turn-flow & rollen
**Host-rol = keuze (host-mode).** Bij het aanmaken kiest de host:
- **`display`** (default, aanbevolen voor TV/groot scherm): de host is **geen speler** — zit niet in
  `turnOrder`, doet geen dares, verdient geen XP/coins. Het host-scherm is het centrale display: het
  toont de actieve card, de spin/state, en notificaties.
- **`player`**: de host doet óók mee als speler (handig zonder los TV-scherm, bv. iedereen op
  telefoon). Dan doorloopt de host setup en zit hij wél in `turnOrder`.

In beide modi krijgen spelers op hun telefoon een melding zoals *"Je bent gedared/geduëld door
{speler}."*

**Wat het centrale display (de "TV-view") toont:** de actieve truth/dare-card, de **timer** (bij
duels en getimede dares), en **wie gekozen is** voor een duel / 2-speler-dare.

**Geen los TV/iPad-scherm? → de TV-view verschijnt op álle telefoons behalve die van de actieve
speler.** De rest van de groep ziet zo de gedeelde presentatie op hun eigen toestel; de actieve
speler ziet in plaats daarvan zijn eigen **actie-view**: dezelfde card-tekst (hij moet 'm immers
lezen/uitvoeren) **plus** zijn knoppen (done, park, respin, soft-limit-keuze). Verschil = controls
vs. presentatie; beide tonen de card. De TV-view is dus een **rol/rendering**, niet per se een apart
apparaat:
- `display`-host aanwezig → TV-view op het hostscherm.
- geen display-host (phones-only) → TV-view op elke niet-actieve telefoon; actieve speler krijgt de
  actie-view.

**Wie verdient wat (canon):**
> **Kern-regel:** **XP** gaat altijd naar de **actieve speler** (turn-holder). **Coins** gaan naar
> wie de dare daadwerkelijk **uitvoert** (of een duel **wint**). Coins per ontvanger =
> `max(3, card.level × card.difficulty × economyMult)` — elke ontvanger krijgt het volle bedrag.

- Per beurt kiest het systeem één **actieve speler** (uit `turnOrder`). Die verdient **alle XP** van
  die beurt (`card.level × card.difficulty`, ×Double-XP indien actief).
- **Solo dare** (actieve speler doet 'm zelf): actieve speler krijgt **XP + coins**.
- **Duel:** de **winnaar** krijgt de coins; de **XP blijft altijd bij de actieve speler**, óók als
  die het duel verliest. (XP = beloning voor "aan de beurt zijn", niet voor winnen.)
- **Dubbel / 2-speler-card** (bv. "kus speler B"): **beide** uitvoerders krijgen coins (elk het volle
  bedrag); de actieve speler krijgt daarbovenop de XP.
- **Actieve speler daret/duëlt iemand anders** (bv. met een geparkeerde of gekochte dare): **A krijgt
  de XP, B (die uitvoert) de coins.**
- Voorbeeld: spelers A B C D E. Beurt → A actief (verdient alle XP). Card is een duo-card → systeem
  kiest D; D krijgt coins, geen XP. A klaar → volgende beurt → B actief, enz.

**Flow:** 1. systeem kiest actieve speler → 2. speler kiest **truth/dare + level** → 3. systeem kiest
gefilterde card van dat type/level → 4. tweede persoon bepaald indien card dat vraagt
(`targetingMode`: self / 50-50 / random) → 5. uitvoeren of duel → 6. XP (actieve speler) + coins
(actief + evt. tweede persoon) → 7. **auto-advance** naar volgende speler (geen handmatige
"next"/spin-tap; de spin is enkel host-scherm-flavor, server-gedreven, één bron).

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
- **`targetRequired` wordt afgedwongen.** Heeft een card `targetRequired: true` en is er geen geldige
  tweede persoon (bv. disconnect, of de enige kandidaat schendt limits/gender/orientation)? → die
  card valt af in `selectCard`; val terug via de normale keten. Nooit een target-card tonen zonder
  geldige target.

### §7.6b Soft limits (zachte grenzen)
Limits zijn er in twee niveaus:
- **Hard limit** = nooit. `selectCard` blokkeert deze altijd (veiligheidsgarantie, §5).
- **Soft limit** = "liever niet, maar bespreekbaar". Blokkeert **niet**, maar de geselecteerde card
  wordt **soft-flagged** teruggegeven. De client toont dan de keuze: *doe 'm* of *respin een level
  hoger* (op level 9 = difficulty hoger i.p.v. level hoger, want 10 is het plafond).
- Schema: `player.limits` (hard) + `player.softLimits` (soft). `selectCard` retourneert
  `{ card, recycled, softFlagged }`.
- **Geen geldige card voor het gekozen level + deze pairing?** → prompt de actieve speler:
  *"Geen veilige kaart op dit level met jullie limits."* met de opties: (a) limits aanpassen,
  (b) lager level accepteren. Niet stilzwijgend een veel lagere card opdringen.

### §7.7 Break-slots, roulette-10 & restart
- **Break-slots (3 per speler, alleen voor DARES).** Parken kan enkel als `phase === 'showing'` én
  `choice === 'dare'`. Parken kost een slot en bewaart de dare.
  - Een geparkeerde dare mag op **elke eigen beurt** alsnog gespeeld worden → slot komt vrij, speler
    krijgt de XP+coins van die dare.
  - **Verlies-conditie:** wil een speler de huidige dare weigeren maar zijn alle 3 slots al vol
    (niets vrij om te parken)? → speler **verliest**; de host toont de vooraf-afgesproken straf.
  - **Einde game:** nog-geparkeerde dares → **volle XP-waarde afgetrokken** (`level × difficulty`).
- **Roulette & level 10.** Roulette `plus1` capt op het **vrijgespeelde** max-level van de speler en
  **kruist nooit vanzelf level 10 binnen**. Zou een bump op 10 uitkomen, dan: respin met level 10
  genegeerd voor die ronde. Level 10 betreedt men **alleen via een bewuste keuze**, en dat vuurt de
  **Extreme-waarschuwing** af. Per-speler instelling: *waarschuw bij elke level-10 card* of
  *éénmalig bevestigen* (daarna geen waarschuwing meer deze sessie).
- **Restart (`restart-game`, host-only).** Reset de room naar `lobby`. Spelers **behouden hun setup**
  (naam, limits/softLimits, kleding, preferences) maar progressie reset: `xp=0`, `coins=0`,
  `currentLevel=1`, `clearedLevels=[]`, `daresCompletedPerLevel={}`, `usedCardIds` leeg,
  `breakSlots` leeg. Geen page-reload-only; dit is een server-event.

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
(§7.2) · coins = `max(3, level×difficulty×economy)` · difficulty 1–3 · `genderRequired` = array|null ·
`selectCard` filtert op `type` · `usedCardIds` per speler + recycle-met-note · preferences = zachte
weging · `host`-veld niet hernoemen · level 10 = "Extreme" met waarschuwing · level 7 = `intimate`
(6–7) · **host-mode = keuze (`display` default / `player`)** · **XP → actieve speler; coins → wie
uitvoert/wint, vol bedrag elk (solo/duel/dubbel/redirect, §7.5)** · **duel-XP blijft altijd bij de
actieve speler, óók bij verlies** · **auto-advance na voltooien** · **targetRequired afgedwongen** · **soft limits
(hard/soft + respin)** · **break-slots: dares-only, herspeelbaar, verlies bij 0 vrije slots** ·
**roulette capt onder 10; 10 enkel via bewuste keuze + waarschuwing** · **`restart-game` reset naar
lobby, setup blijft, progressie reset** (§7.5–§7.7).

Tref je een nog-open beslissing? → vraag het, verzin niks zelf.
