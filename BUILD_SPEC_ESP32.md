# Truth or Dare 2.0 — ESP32 Event Tablet Build Spec

> Standalone event setup: Raspberry Pi server + CrowPanel ESP32 tablets as native clients.
> The Node.js server is **unchanged** — this is a second client for the same backend.
> Web version (BUILD_SPEC.md) stays the primary track; this is a parallel hardware track.

---

## Concept

At events, personal phones are a privacy risk (cameras). This setup replaces phones with
dedicated tablets that only run the game. No personal data, no cameras accessible, no
distractions.

**Hardware per event:**
- 1× Raspberry Pi (any model with WiFi) — runs the Node.js server + WiFi hotspot
- N× Elecrow CrowPanel Advance 3.5" (ESP32, 320×240 IPS touch, LoRa, SD slot) — player tablets
- 1× larger screen optional (HDMI to Pi) — host/TV view

**SD card swap:** each game gets its own SD card with its own firmware. Swap card, reboot,
different game. No reinstalling, no configuration.

---

## Architecture

```
[ Raspberry Pi ]
  - Runs Node.js server (existing server.js, zero changes)
  - Creates a local WiFi hotspot (no internet needed)
  - Optional: HDMI output for host/TV view in browser

[ CrowPanel tablets ] (one per player)
  - Connect to Pi hotspot via WiFi
  - Run native LVGL app (C++ / ESP-IDF)
  - Communicate with server via WebSocket (same events as web client)
  - SD card contains the firmware image for this game
```

The server never knows or cares whether the client is a browser or an ESP32.
Same Socket.io events, same game logic, same safety guarantee.

---

## Phase 1 — Raspberry Pi setup

### 1.1 Hardware
- Raspberry Pi 4 or 5 recommended (Pi Zero 2W works for small groups)
- SD card with Raspberry Pi OS Lite
- Optional: official Pi touchscreen or HDMI display for host view

### 1.2 Pi as WiFi hotspot
- Pi creates its own access point (SSID: `TruthOrDare`, password: configurable)
- No internet connection required at the venue
- Node.js server runs on `192.168.4.1:3000` (or similar)
- Tablets connect to Pi hotspot on boot automatically

### 1.3 Server autostart
- `server.js` starts on boot via systemd service
- Pi prints IP + QR on HDMI display (or small attached screen) on startup
- One power cable = fully running game server

---

## Phase 2 — ESP32 native client (WiFi mode)

### 2.1 Hardware
- Elecrow CrowPanel Advance 3.5" HMI
- ESP32-S3 chip, 320×240 IPS touch screen
- Built-in SD card slot, WiFi, LoRa
- Product: https://www.elecrow.com/crowpanel-advance-3-5-hmi-esp32-ai-display-for-meshtastic-320x480-ips-artificial-intelligent-screen.html

### 2.2 Firmware stack
- ESP-IDF or Arduino framework
- LVGL for UI (already supported by CrowPanel)
- ArduinoWebsockets or ESP-IDF WebSocket client
- WiFi connects to Pi hotspot on boot

### 2.3 Screens to implement (native LVGL)
Mirror the key web client screens:

| Screen | Content |
|--------|---------|
| Boot / connecting | WiFi connection status, server handshake |
| Join | Enter name, pick emoji |
| Setup | Hard limits, soft limits, gender, body type, orientation |
| Lobby | Player list, waiting for host to start |
| Level picker | Truth / Dare buttons + level 1–10 slider |
| Card display | Card text, timer if applicable, Done / Park buttons |
| Duel | Duel text, waiting for host to resolve |
| HUD overlay | XP, coins, break slots, active power-ups |
| Shop | Power-up list, buy button, coin balance |
| End game | Scores, restart option |

### 2.4 WebSocket event mapping
Reuse exact same Socket.io event names as the web client:
`join-room` · `player-setup` · `player-ready` · `choose-level` · `pick-truth-dare` ·
`complete-dare` · `use-break-slot` · `replay-parked-dare` · `respin-card` ·
`buy-powerup` · `use-powerup` · `end-game` · `restart-game`

Server broadcasts: `game-state` · `card-drawn` · `turn-advanced` · `duel-started` ·
`duel-resolved` · `game-ended`

### 2.5 SD card image
- Compiled firmware binary on SD card
- `config.json` on SD: WiFi SSID/password, server IP, language preference
- Swap SD card = swap game, zero reflashing

---

## Phase 3 — LoRa / Meshtastic mode (future, no WiFi needed)

For large venues or outdoor events where WiFi doesn't cover the whole space.

### 3.1 Concept
- Pi has a LoRa module (or a Meshtastic node connected via USB)
- Tablets communicate via LoRa mesh instead of WiFi
- Game state packets are small JSON — fits LoRa bandwidth easily

### 3.2 Packet design (keep small)
```json
{ "t": "card", "id": "d042", "lvl": 7, "txt": "...", "target": "p2" }
{ "t": "act", "ev": "complete-dare", "pid": "p1" }
{ "t": "state", "xp": 42, "coins": 18, "slots": 2 }
```

### 3.3 Range
- LoRa: up to 1–2 km line of sight, easily covers any venue
- Meshtastic mesh: tablets relay for each other, extends range further
- No WiFi infrastructure needed at all

---

## Open decisions

| # | Question |
|---|----------|
| 1 | Pi model — Pi 4 (powerful, warm) vs Pi Zero 2W (tiny, cheap, slower) |
| 2 | Host view — HDMI to big screen, or one tablet dedicated as host display? |
| 3 | Hotspot SSID/password — hardcoded or configurable per event? |
| 4 | Language per tablet — set in `config.json` on SD, or selected on boot screen? |
| 5 | Phase 3 priority — WiFi first, LoRa later, or design for both from the start? |
| 6 | How many tablets per event? Determines if one-per-player or shared |

---

## What stays unchanged

- `server.js` — zero modifications needed
- `data/dares.json` — same cards
- `lib/selectCard.js` — same safety engine
- `public/index.html` — web version still works alongside ESP32 version
- All game logic, XP/coins, safety guarantee — identical

The ESP32 client is purely a UI layer. The server is the source of truth.
