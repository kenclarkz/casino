# THE BANKER

**20 briefcases. $1 to $1,000,000. One question: deal or no deal?**

An original cinematic game show for **1–8 players** — play solo, against
house bots, or with a full party. The TV is the stage, the phones are the
controllers, and the banker is always watching.

> **Play it:** <https://kenclarkz.github.io/casino/>

---

## How it works

| Screen | URL | Role |
|--------|-----|------|
| Join lobby | `/` | Enter your name + avatar + the 4-letter show code |
| The TV | `/tv` | Shared cinematic game screen — shows a QR code for players to join |
| Controller | `/play` | Each phone is one contestant's private control panel |

- **1–8 players.** Open `/tv`, it generates a show code and QR. Everyone else
  scans or types the code at `/` and takes a seat — or hit **+ ADD A BOT** on
  the TV to fill empty podiums (tap a bot chip to send it home). One contestant
  alone is a complete show; bots deal and no-deal on their own judgment.
- **WebSockets-style protocol, server-authoritative state.** Clients only ever
  send *actions* (`openCase`, `deal`, `noDeal`, `twist`, `addBot`); all game
  rules, validation and privacy filtering live in one authority module
  (`lib/the-banker/engine.js` + `host.js`). Case values and offer amounts are
  filtered per-viewer in snapshots — nobody can peek (bots included: they judge
  offers from public info only).

## The game

- **20 numbered mystery cases** hold randomized prizes from **$1 to $1,000,000**.
- Each player secretly selects and owns a case.
- Players take turns opening **other** players' view: any case that isn't owned.
  Opened prizes come off the public prize board.
- At predetermined milestones (a schedule that tightens as the board drains)
  **the banker calls** with an offer computed from each player's remaining odds.
- **Every active player gets their own private offer** on their phone, and each
  decides independently:
  - **DEAL** → lock in that amount, go CASHED OUT, stop taking turns, spectate.
  - **NO DEAL** → keep playing. Other players are never affected by your choice.
- If everyone cashes out, the show ends immediately.
- Once per show, mid-game, **THE TWIST**: everyone who stood gets a one-time
  choice to swap their case's contents with another mystery case.
- At the end: full reveal of remaining cases, final values, locked deals, and
  the leaderboard. Highest final value wins the crown 👑.

AFK protection: turn timers auto-play (random pick/open) and silent offers
count as NO DEAL, so the show can never stall.

## On the TV

Premium game-show presentation: animated 3D case flips, live prize board,
player podium rail with avatars/status (active vs CASHED OUT), banker call
overlay, DEAL/NO DEAL tally + countdowns, dramatic glitch-out twist reveal,
confetti finale, procedural WebAudio stings (no audio files). 16:9-first,
responsive down to phones.

## Networking

Two interchangeable transports speaking the same JSON protocol:

1. **P2P (default)** — WebRTC data channels via [PeerJS](https://peerjs.com)
   (vendored, uses its free public broker). The TV tab hosts the room; phones
   connect directly. Works on GitHub Pages' static hosting, across networks.
2. **Self-hosted WebSockets** — `node server.js` serves everything *and* runs
   the authoritative engine per room over real RFC-6455 WebSockets at `/ws`
   (zero npm dependencies). Pages served by it automatically switch transports.

## Running locally

```bash
# option A: pure static (P2P transport)
python3 -m http.server 8000

# option B: the works (WebSocket transport)
npm start            # node server.js → http://localhost:8080
```

## Tests

The pure game core (RNG, prize board, full state machine, host routing) runs
in Node with zero dependencies:

```bash
npm test             # 42 tests: rules, offers, cash-outs, twist, bots, timeouts, privacy
```

## Structure

```
index.html                 # / — join lobby
tv/index.html              # /tv — the big screen
play/index.html            # /play — phone controller
assets/banker.css          # all styling
lib/the-banker/
  prizes.js                # the $1…$1,000,000 board
  rng.js                   # seeded mulberry32 (deterministic games)
  protocol.js              # wire constants + timings
  engine.js                # THE authoritative state machine (pure, tested)
  host.js                  # transport-agnostic authority glue (rooms, roles)
  net.js                   # PeerJS host/client + WebSocket transports
  client.js                # shared client connection helper
  tv.js                    # TV renderer & P2P host wiring
  play.js                  # phone controller UI
  audio.js                 # procedural WebAudio stings
server.js                  # optional zero-dep HTTP+WebSocket server
vendor/                    # peerjs.min.js, qrcode.js (MIT)
tests/                     # Node test suite
```
