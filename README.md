# Chest-Tournament Manager

A production-ready, offline-first chess tournament manager built with strict TypeScript, Vite, and Tailwind CSS. It is entirely client-side: there is no account, server, or database. First-time visitors create their tournament through the setup page; returning organizers resume their saved tournament library.

## Features

- Multi-tournament library: create, choose, resume, import, and delete independent events
- Swiss pairing by score group, with repeat-opponent avoidance, color balancing, and fair bye assignment
- Round-robin pairing via the circle method with a responsive all-play-all crosstable
- Adaptive visual knockout trees: compact one-sided brackets for small fields and mirrored brackets for larger events
- Automatic first-round creation, instant result entry, and organizer confirmation before each subsequent round
- Live standings with Buchholz, Buchholz Cut 1, Sonneborn–Berger, wins, and color counts
- Reusable player-profile directory with starter profiles, compressed photos, flagged federation selection, CSV import/export, and per-tournament registration
- PGN, PDF, PNG/JPG, and complete ZIP package export in the browser
- Projector mode, keyboard navigation, responsive mobile layout, and accessible focus states
- Persistent Dark, Light, and classic green-and-ivory Criterion themes
- Automatic localStorage persistence, JSON backup and restore
- Service worker for offline use after the first successful load
- Relative asset paths and GitHub Pages deployment workflow

> Team is visible as a planned tournament type, but team pairing generation is intentionally disabled.

## Architecture

```text
src/
├── components/          # Small, reusable HTML renderers
│   └── PlayerAvatar.ts
├── models/              # Shared domain types
├── services/            # Pairing, persistence, standings, media and exports
│   ├── avatar.ts
│   ├── exporters.ts
│   ├── pairingEngine.ts
│   ├── pgnExporter.ts
│   ├── standings.ts
│   └── storage.ts
├── styles/              # Responsive application theme
├── utils/               # Pure formatting and federation helpers
├── main.test.ts         # Browser-like interaction regression tests
└── main.ts              # Application state, view composition and DOM events
```

Domain calculations and browser persistence live outside the UI layer. Complex algorithms contain comments explaining intent and constraints rather than repeating individual statements. HTML interpolation is centralized through an escaping utility, and reusable visual fragments are isolated in `components`.

## Local development

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

## Automated quality checks

```bash
npm run check       # Strict TypeScript and unit/integration tests
npm run test:e2e    # Chromium desktop/mobile workflows and file exports
npm audit           # Dependency vulnerability scan
```

The browser suite exercises tournament creation, reusable players, pairing, results, finalization, persistence, round history, projector mode, backup restore, CSV, mobile navigation, and every export format.

## Production build

```bash
npm run build
npm run preview
```

The static site is emitted to `dist/`. No runtime server is required.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run the included `Deploy to GitHub Pages` workflow manually.

`vite.config.ts` uses `base: './'`, so assets resolve correctly from project pages and custom domains.

## CSV format

Headers are case-tolerant. Recommended format:

```csv
Name,Rating,Age,Club,Federation,FIDE ID
Alex Morgan,1850,16,Central Chess Club,PHI,5200000
```

`Name`, `Rating`, and `Age` are required; all other player fields are optional. Age category is derived automatically as U8, U10, U12, U14, U16, U18, Open, or Senior.

## Offline and local data

Tournament and reusable player data are stored under `castling.library.v2` in localStorage. Use **Backup** before clearing browser storage or changing devices. The service worker caches the application shell and loaded build assets. The first visit must complete online; subsequent visits can work offline.

## Keyboard shortcuts

- `Ctrl/Cmd + N`: Add player
- `Escape`: Close a dialog, menu, or projector mode

## Pairing notes

The Swiss engine sorts players by score and rating, assigns a bye to the lowest eligible player who has not already received one, and minimizes a cost function for score difference, prior opponents, and color imbalance. It is suitable for club and scholastic events. High-stakes FIDE-rated events should still be verified by a licensed arbiter against current federation rules.

## Privacy

All tournament information stays in the browser unless the organizer explicitly exports a file. No analytics or network API is used.
