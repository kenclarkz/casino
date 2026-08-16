# THE LIMINAL

**Ten floors. No exits. Only descent.**

A first-person survival horror game built with vanilla Three.js — no engine, no
build step, no asset files. Everything (geometry, materials, audio, UI) is
generated at runtime, so the whole game ships as a handful of plain ESM modules.

> **Play it:** <https://kenclarkz.github.io/casino/>

---

## The Game

- **10 procedurally generated floors** — foyer, hallway, backrooms, pool,
  office, mall, hospital, school, metro, void — each seeded and regenerable
  from a save file.
- **Loot & crafting** — scavenge containers, combine scrap into improvised
  weapons, bandages, molotovs and flashlights.
- **Scarce guns** — ammo is rare; every shot is loud and draws the dark.
- **Stealth matters** — lights attract them, running is loud, crouching is
  silence. Each enemy type has a different weakness.
- **THE ARCHITECT** — a three-phase boss on floor 9 that glitches through the
  world and spawns Shades.
- **Save & checkpoints** — the run, seed, and floor are persisted to
  localStorage; death drops part of what you carried.

## Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Move | WASD | Left joystick |
| Look | Mouse | Right joystick |
| Attack / Aim | LMB / RMB | Attack / Aim buttons |
| Interact | E | E button |
| Flashlight | F | Flashlight button |
| Run | Shift | Run button |
| Crouch (stealth) | Ctrl / C | Crouch button |
| Inventory / Craft | Tab / Q / I | Bag button |
| Heal | H | — |
| Pause | Esc | — |

## Running locally

No build required — the browser loads the modules directly. Serve the folder
over HTTP (ESM needs a server, not `file://`):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Tests

The pure game logic (RNG, level generation, items, inventory, saves) is
covered by unit tests that run in Node:

```bash
npm ci
npm test
```

## Structure

```
index.html                 # host page + import map for three.js (CDN)
liminal.css                # all game UI styling (vanilla CSS)
lib/the-liminal/
  game.js                  # orchestrator: floors, loop, save, interactions
  levelgen.js              # procedural grid + rooms + loot + enemies
  builder.js               # three.js world geometry / colliders / props
  player.js, combat.js, enemies.js
  flashlight.js, fx.js, events.js
  audio.js                 # procedural WebAudio (no audio files)
  input.js, mobile.js      # desktop + touch input
  ui.js                    # DOM HUD, menus, inventory, crafting
  inventory.js, items.js, config.js
  environments.js, save.js, utils.js
tests/the-liminal/         # Node unit tests
```
