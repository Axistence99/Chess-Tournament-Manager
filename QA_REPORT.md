# Chess Pairing Manager — QA Report

## Result

All automated checks pass as of 2026-09-28.

- TypeScript: pass
- Unit/integration tests: 6/6 pass
- Chromium end-to-end tests: 8/8 pass
- Production build: pass
- Dependency audit: 0 known vulnerabilities

## Browser workflows tested

- First-run tournament creation
- Preset and newly created player profiles
- Player registration and localStorage persistence after reload
- Swiss pairing generation and round locking
- Result entry, standings calculation, and tournament finalization
- Gold, silver, and bronze final podium
- Tournament edit lock after Round 1
- Round history and player profile dialogs
- Projector mode open/close
- Tournament chooser
- CSV player import and export
- JSON backup export and restore
- Equal-size mobile navigation and active Pairings/Rounds states
- No horizontal document overflow in tested mobile views

## Export files tested

Each export was downloaded in a real Chromium session and checked for content or binary signature.

| Export          | Validation                                 | Result |
| --------------- | ------------------------------------------ | ------ |
| Tournament PGN  | Required tags and result content           | Pass   |
| Standings PDF   | `%PDF` signature and non-empty report      | Pass   |
| Pairings PDF    | `%PDF` signature and non-empty report      | Pass   |
| Player-list PDF | `%PDF` signature and non-empty report      | Pass   |
| Standings PNG   | PNG binary signature                       | Pass   |
| Standings JPG   | JPEG binary signature                      | Pass   |
| Tournament ZIP  | ZIP signature and required package entries | Pass   |
| Player CSV      | Headers and player content                 | Pass   |
| JSON backup     | Tournament and round data                  | Pass   |

The ZIP was opened in the test and verified to contain `Tournament.pgn`, `Standings.pdf`, `Pairings.pdf`, `Standings.png`, and `Backup.json`.

## Pairing and standings tests

- Odd-player Swiss bye allocation
- No duplicate player within a round
- Repeat-opponent avoidance in the following Swiss round
- Bye rotation to another eligible player
- Complete round-robin coverage over `n - 1` rounds
- Points, wins, draws, losses, colors, Buchholz, and Sonneborn-Berger calculations
- PGN quote escaping and mandatory metadata

## Issues found and corrected during QA

1. Unit-test discovery also attempted to execute Playwright specifications. Test scripts now scope Vitest to `src` and Playwright to `tests`.
2. End-to-end selectors were ambiguous where hidden export markup duplicated visible player/ranking text. Tests now target visible feature containers precisely.
3. GitHub Pages deployment previously built without running the full quality gate. The workflow now runs TypeScript/unit checks and Chromium end-to-end tests before deployment.
4. Generated test artifacts are now excluded through `.gitignore`.

No failing application workflow or export remained after the final test run.

## Commands

```bash
npm run format
npm run check
npm run test:e2e
npm run build
npm audit
```

## Known non-blocking build note

Vite reports a large initial JavaScript chunk because PDF, DOM-to-image, ZIP, and offline export libraries are bundled for immediate offline availability. This is a performance optimization opportunity, not a functional or security failure.
