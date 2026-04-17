# Mega Tic Tac Toe

A strategic multiplayer board game that takes classic tic-tac-toe and scales it up with larger grids, more players, and an asymmetric power system.

## Quick Start

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`. Works on mobile browsers — add to home screen for a fullscreen PWA experience.

## Game Overview

### Two Modes

- **Normal Mode** — Classic rules, no powers. Pure strategy on a larger grid.
- **Powers Mode** — Each player picks a unique power that changes how they interact with the board.

### Configuration

| Setting       | Range       | Default |
|---------------|-------------|---------|
| Grid size     | 7×7 – 20×20 | 12×12   |
| Players       | 2 – 4       | 2       |
| Win condition  | Auto-scales | —       |

### Win Condition Scaling

Win conditions auto-adjust based on grid size and player count to keep game length consistent:

| Grid Size   | Line Length | Lines to Win (2-3 players) | Lines to Win (4 players) |
|-------------|-------------|----------------------------|--------------------------|
| 7×7 – 9×9  | 4 in a row  | 2                          | 1                        |
| 10×10 – 14×14 | 5 in a row | 2                         | 1                        |
| 15×15 – 20×20 | 5 in a row | 3                         | 2                        |

These are the current defaults. Players can override line length and lines-to-win in advanced settings.

## Powers System

All powers follow the same template: **place your normal tile + do your special action**. This ensures equal tile output across powers — the difference is in *how* you gain advantage, not *how much*.

### The Four Launch Powers

**Double Place** (◇)
- Every 3rd turn, place 2 tiles instead of 1
- No cooldown
- Consistent, reliable board presence
- *Weakness: both tiles are visible, easy to read*

**Takeover** (△)
- Place your tile normally, then steal one opponent's tile
- Cooldown scales with grid size (2-4 turns)
- High-impact burst that disrupts opponent lines
- *Cannot steal scored tiles*
- *Weakness: timing-dependent, weaker if opponents spread out*

**Block** (□)
- Place your tile normally, then choose a denial area where no one can place
- Block area scales with line length (2x2 to 4x4)
- 2-turn cooldown
- *Weakness: denial is temporary and doesn't score directly*

**Teleport** (◎)
- Place your tile normally, then move one of your existing tiles to an empty cell
- 3-turn cooldown
- Great for converting near-lines or escaping dead positions
- *Weakness: costs tempo if you move a tile away from a strong lane*

### Counter-Play (Soft Rock-Paper-Scissors)

```
Double Place → pressures → Teleport (raw board presence can outpace repositioning)
Teleport     → outplays → Block (jump around denial zones)
Block        → disrupts → Double Place (limit where follow-up tiles can go)
Takeover     → punishes → greedy lines (steals key unscored anchors)
```

### Adding New Powers

New powers follow the same template: `normal tile + special action + cooldown`. The system is designed to be extensible — add the power definition to the `POWERS` array and handle its action in `handleClick`.

## Mobile UX

The game is designed mobile-first with larger grids requiring zoom and scroll:

- **Pinch-to-zoom** — implemented on touch devices
- **+/− zoom buttons** — current implementation for adjusting cell size
- **Auto-scroll** — board auto-centers on the last move
- **Minimap** — corner overlay appears when zoomed/overflowing
- **Double-tap snap zoom** — planned for quick quadrant navigation

## Architecture

```
src/
├── main.jsx              # React entry point
├── App.jsx               # App wrapper
└── MegaTicTacToe.jsx     # Main game UI and flow
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `makeBoard(n)` | Creates an n×n grid of null cells |
| `findLines(board, playerId, length)` | Finds all completed lines for a player |
| `isBlocked(blocks, r, c, globalTurn)` | Checks whether a cell is inside an active block area |
| `pruneBlocks(blocks, globalTurn)` | Removes expired block areas |
| `scoreAndMark(board, playerCount, lineLen, prevScores)` | Finds scorable lines and updates scores/marks |
| `applyPendingLineScore(board, playerCount, lineLen, pending, offset, prevScores)` | Applies chosen segment on overlong lines |
| `getWinConditions(gridSize, playerCount)` | Returns auto-scaled win conditions |

### Cell Data Shape

```js
null                                    // empty
{ owner: 0, visible: true }            // normal tile
// Block power uses a separate `blocks` array for temporary denial zones
```

### Game State

| State | Purpose |
|-------|---------|
| `board` | 2D array of cells |
| `cp` | Current player index (0-3) |
| `turn` | Round number (increments when all players have gone) |
| `globalTurn` | Total individual turns taken (used for block expiry timing) |
| `scores` | Object mapping player index → completed line count |
| `cooldowns` | Object mapping player index → remaining cooldown turns |
| `pwr` | Power state: `{ active, used, firstDone }` |

## Roadmap

### Phase 1 — Core Gameplay (current)
- [x] Setup screen with all configuration options
- [x] Normal mode (no powers)
- [x] Powers mode with all 4 launch powers
- [x] Win detection with auto-scaling conditions
- [x] Local pass-and-play multiplayer
- [x] Zoom controls
- [x] Auto-scroll to last move

### Phase 2 — Polish
- [ ] Pinch-to-zoom on touch devices
- [ ] Minimap when zoomed in
- [ ] Move history / undo
- [ ] Advanced settings (manual win condition override)
- [ ] Sound effects (tile place, capture, win)
- [ ] Animations (line completion glow, power activation)
- [ ] Turn timer (optional)

### Phase 3 — Online Multiplayer
- [ ] Room creation with shareable codes
- [ ] Real-time sync (WebSocket or WebRTC)
- [ ] Lobby system
- [ ] Spectator mode

### Phase 4 — Growth
- [ ] More powers (unlockable)
- [ ] Player accounts and stats
- [ ] Matchmaking
- [ ] Capacitor wrap for App Store / Google Play

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React 18 | Component model fits game state well |
| Build tool | Vite | Fast dev server, instant HMR |
| Styling | Inline styles | No build dependency, easy to refactor to Tailwind later |
| Deployment | Vercel / Netlify | Free tier, instant deploys, global CDN |
| PWA | manifest.json + meta tags | Home screen install, fullscreen, offline-capable |

## Design Principles

- **Clean & minimal** — warm neutral palette (#F7F6F3 background, #1a1a1a text), generous whitespace, subtle shadows
- **Mobile-first** — designed for touch, scales up to desktop
- **No visual clutter** — information density is controlled; toast messages for transient feedback
- **Colour-coded players** — Blue, Coral, Sage, Amber — distinct and accessible
- **Consistent UI language** — segmented controls, rounded cards, pill badges

## License

Private — not yet open source.
