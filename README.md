# Truth or Dare 2.0 🔥

Advanced, erotic, **kink-safe** party game for consenting adults (18+).  
LAN multiplayer — everyone plays from their phone, no app needed.

---

## Download & run

### Option A — Download the release zip (recommended)

1. Go to the [**Releases**](../../releases) page and download the latest `truth-or-dare-2.zip`
2. Unzip it anywhere on your computer
3. **Windows:** double-click `start.bat`  
   **Mac / Linux:** open Terminal in the folder and run `./start.sh`
4. The terminal shows your local URL + network URL + QR code
5. Open the **network URL** on everyone's phone (same Wi-Fi)

> Node.js is required. Get it free at [nodejs.org](https://nodejs.org) (v18+).  
> The zip already contains all dependencies — no `npm install` needed.

### Option B — Clone the repo

```bash
git clone https://github.com/dylanmccann3103-creator/truth-or-dare-2.git
cd truth-or-dare-2
npm install
node server.js
```

---

## How to play

1. **Host** opens the network URL and clicks **Host a Game**  
   *(or scans the QR code that appears in the terminal)*
2. **Players** join by scanning the QR in the lobby, entering the URL, or typing the room code
3. Each player fills in their setup:
   - **Name** and **language** (🇳🇱 Dutch / 🇬🇧 English)
   - **Clothing** they're wearing (the game tracks what gets removed)
   - **Gender**, **orientation**, **genitals** — used to filter dares to what's relevant
   - **Preferences** — tags you enjoy (used to weight card selection toward you)
   - **Limits** — hard blocks (🔒 never shown to anyone else)
   - **Soft limits** — dares you'd rather skip but are open to discussing
4. Host configures the room (level range, economy, targeting mode, power-ups) and clicks **Start**
5. The bottle spins → active player picks **Truth** or **Dare** + a level
6. A card is drawn — filtered server-side to respect everyone's limits
7. Earn XP and coins, unlock higher levels, buy power-ups

---

## Level ladder

| Level | Vibe |
|-------|------|
| 1 | Icebreakers — fun, no touching |
| 2 | Flirty — compliments, eye contact |
| 3 | Light touch — holding hands, hugs |
| 4 | Kissing — cheek, hand, short kiss |
| 5 | Sensual — longer kiss, clothing teasing |
| 6 | Seduction — massage, lap, water/ice dares |
| 7 | Intimate — heavier touching, clothing removal |
| 8 | Erotic — explicit dares, body-type filtering active |
| 9 | Explicit — kinky categories (bondage, spanking…) |
| 10 | **Extreme** ⚠️ — the hardest allowed by everyone's limits |

Higher levels unlock progressively as you complete dares.

---

## Kink-safety guarantee

- **Limits are strictly private** — stored server-side, never broadcast to other players
- Card selection is a hard filter, not a suggestion — a card with a blocked tag is **never** shown
- Filtering covers both the performer **and** the target of every dare
- The 18+ gate must be confirmed before anything is visible

---

## Tag system

| Tag | Blocks |
|-----|--------|
| 🎲 General | General/neutral dares |
| 😏 Flirty | Flirty, complimentary |
| 👗 Clothing | Stripping / clothing swap |
| 💪 Body | Body contact, massage |
| 🏃 Physical | Physical challenges |
| 🦶 Feet | Feet-related |
| 💋 Kissing | Any kissing (cheek, mouth, body) |
| 🗣️ Speaking | Say something aloud — whisper, describe fantasy |
| 👅 Oral sex | Oral sex acts |
| 🔥 Intimate | Intimate (non-sexual) touch |
| 🌡️ Explicit | Sexual acts |
| 🍑 Anal | Anal stimulation |
| ⛓️ Bondage | Restraint, collar, BDSM elements |
| 🎀 Toy | Sex toys |
| 🌍 Public | Semi-public setting (car, balcony…) |
| 📸 Exposure | Nudes, selfies, telling someone outside the game |

---

## Card Editor

Open `http://localhost:3000/editor` while the server is running to add, edit, or remove cards.  
Cards live in `data/dares.json` — editing the file directly also works; restart the server to reload.

### Card packages

Extra card packs (e.g. *His & Her*) can be downloaded and activated from the Package Library on the landing screen.

---

## Extending the game

- **Add cards:** use the editor at `/editor`, or edit `data/dares.json` directly
- **Add a language:** drop a file at `data/lang/<code>.json` mapping card `id → translated text`
- **Add a card pack:** add an entry to `public/packages/index.json` and a matching JSON file

---

## Requirements

- [Node.js](https://nodejs.org) v18 or newer (free, one-time install)
- A local network (Wi-Fi) so phones can reach the host's computer
- A modern browser on each device (Chrome, Safari, Firefox — recent versions)
