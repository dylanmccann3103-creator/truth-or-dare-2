# Truth or Dare 2.0 🔥

Advanced, erotic, kink-safe party game. LAN multiplayer — phones welcome.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or newer

---

## Setup (first time only)

Open a terminal in this folder and run:

```bash
npm install
```

---

## Start the game

```bash
npm start
```

The terminal will print:

```
╔══════════════════════════════════════╗
║   Truth or Dare 2.0  🔥  Server Up   ║
╠══════════════════════════════════════╣
║  Local:   http://localhost:3000       ║
║  Network: http://192.168.1.x:3000    ║
╚══════════════════════════════════════╝
```

- **Host** opens `http://localhost:3000` in their browser
- **Other players** open the **Network** URL on their phone (same WiFi required)
- Or players can scan the QR code shown in the lobby

---

## How to play

1. **Host** clicks "Host a Game" → a room code + QR code appears
2. **Players** join via QR, URL, or room code
3. Each player fills in:
   - Their **name**
   - **Clothing** they're wearing (detailed — left sock, right sock, underwear, etc.)
   - **Preferences** — tags they enjoy (used to pick better cards for them)
   - **Limits** — tags to skip (🔒 private, never shown to anyone else)
4. Host clicks **Start Game**
5. **Spin the bottle** → the bottle lands on a player
6. That player picks **Truth** or **Dare**
7. A card is drawn — filtered to respect their private limits
8. Play, repeat, have fun

---

## Tag system

| Tag | What it covers |
|---|---|
| 🎲 General | Clean/fun for anyone |
| 😏 Flirty | Light flirting |
| 👗 Clothing | Involves clothing removal/swap |
| 💪 Body | Body contact or display |
| 🏃 Physical | Movement/physical challenges |
| 🦶 Feet | Foot-related |
| 👄 Mouth | Mouth/kiss related |
| 🗣️ Oral | Speaking dares or oral activities |
| 💋 Intimate | Intimate contact |
| 🔥 Explicit | Sexually explicit |

---

## Kink-safety

Limits are **strictly private** — they are stored server-side and never sent to other players. The card engine silently filters out any truth or dare that contains a tag the player has marked as a limit.

---

## Adding content

Open `server.js` and find the `CONTENT` object near the top. Add truths/dares to either array following the format:

```js
{ text: "Your dare text here.", tags: ['dare_tag', 'another_tag'] }
```

Restart the server after editing.
