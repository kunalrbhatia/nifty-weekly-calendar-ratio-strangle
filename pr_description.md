## Summary

This PR adds a position reconciliation guard module (`src/helpers/reconcile.ts`) and integrates it into the application `startup/resume` path and expiry wind-down cron callback in `src/main.ts`.

### Key Changes

- **New Reconciliation Module (`src/helpers/reconcile.ts`)**:
  - Compares OPEN legs in the local store (`data/position-nifty.json`) against live broker positions fetched via Angel One SmartAPI (`getPosition()`).
  - Short-circuits safely when store status is `NONE` or `CLOSED`, or when in paper mode.
  - Flags mismatches for missing legs (`ZERO position`), opposite side positions (`OPPOSITE side`), quantity mismatches (`shares`), or broker fetch errors (`Could not fetch broker positions`).
  - Sends a single formatted alert via Telegram using `sendAlert()` and returns `{ ok: false, mismatches }` without auto-closing or auto-modifying local store state.

- **Wired Resume Path & Wind-Down Cron (`src/main.ts`)**:
  - In `initializeApp()`, when store status is `FULL_ENTRY` or `PARTIAL_ENTRY`, runs `reconcileStoreWithBroker()` prior to WebSocket reconnection.
  - In the Tuesday 15:20 IST expiry wind-down cron schedule, executes reconciliation before `executeExit('EXPIRY_WIND_DOWN')`. If mismatches exist, skips wind-down exit and sends an alert.

- **Type Definitions & Test Suite**:
  - Added `getPosition(): Promise<any>;` signature to `SmartAPI` interface in `src/types/smartapi-javascript.d.ts`.
  - Added unit test suite in `src/helpers/reconcile.spec.ts` covering 8 scenarios (clean state, paper mode, matching position, missing leg, opposite side, quantity mismatch, API error, alert dispatching).

### Verification

- `pnpm verify` passed (Prettier formatting, ESLint, TypeScript compilation `tsc --noEmit`, Jest coverage, production build `pnpm run build`).
