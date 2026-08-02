### Description

Implement Mode 2 execution logic for selling double quantity (2 lots) of the exact same strikes in T0 expiry as the T1 long legs (`longCEStrike` and `longPEStrike`). Added `MODE` environment variable configuration (`1` or `2`) and updated basket generation, strategy documentation, and verification suites.

### Changes

- Updated `src/config/env.ts`, `.env.example`, and `.env` with `MODE` parameter (`1` for target premium ratio, `2` for same strike double sell).
- Modified `src/jobs/entry.ts` Phase C to select T0 short strikes based on `MODE`.
- Updated `src/jobs/generateBasket.ts` dry-run basket generator for `MODE` support.
- Updated documentation in `README.md`, `SESSION_NOTES.md`, and `blueprint.md`.

### Verification

- Ran `pnpm run verify` (`format:check`, `lint`, `tsc --noEmit`, `test:coverage`, `build`). All passed.
- Successfully generated dry-run basket for `MODE=2` via `pnpm run generate-basket`.
