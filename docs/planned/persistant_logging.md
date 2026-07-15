# Phase C — OPFS Persistent Decimated Logging

## Overview

Persist telemetry data to Origin Private File System (OPFS) via a dedicated Web Worker. Only **Mode 1 (Continuous Decimated Logging)** is in scope for v1 — 1-second condensed summary blocks written to daily files.

Mode 2 (Event-Triggered High-Res Logging) is explicitly deferred.

## Architecture

```
Main Thread (uPlot UI)
    │  postMessage({ type: "append", ... })
    ▼
logWorker.ts (Web Worker)
    │  createSyncAccessHandle()
    ▼
OPFS Storage  (log_YYYY-MM-DD.bin)
```

## Binary Format (Mode 1)

**20-byte fixed-length frame** per 1-second window:

| Offset | Type    | Field                          |
| ------ | ------- | ------------------------------ |
| 0      | Float64 | Unix epoch timestamp (seconds) |
| 8      | Float32 | Min current in block (A)       |
| 12     | Float32 | Max current in block (A)       |
| 16     | Float32 | Average current in block (A)   |

**Footprint:** 20 B/s × 86,400 s/day ≈ **1.72 MB per 24 hours**

## Implementation Plan

### Step 1 — Log Worker

Create `src/scope/persist/logWorker.ts`:

- **`"start"`** — Open/create `log_YYYY-MM-DD.bin` in OPFS root via `navigator.storage.getDirectory()` → `getFileHandle(name, { create: true })` → `createSyncAccessHandle()`. Store the handle.
- **`"append"`** — Write 20-byte record using `DataView` on a reusable `ArrayBuffer(20)`. Advance write cursor.
- **`"stop"`** — Flush (if needed), close sync access handle. Null out reference.
- **`"get-files"`** — List all `log_*.bin` entries in the OPFS root directory.
- **`"open-existing"`** — Open a specific file for read (for future log viewer).

### Step 2 — Wire into Engine Polling Loop

In `src/scope/hooks/useScopeEngineManager.ts`:

- **On mount**: Instantiate `logWorker`, post `{ type: "start" }`.
- **Every ~60 frames (~1s)**: Compute a 1-second summary from the raw ring buffer:
  - Sample the last second of observations
  - Extract min/max/avg current
  - Post `{ type: "append", timestamp: unixEpochSec, minI, maxI, avgI }`
- **On unmount**: Post `{ type: "stop" }`, terminate worker.

### Step 3 — Logging Toggle UI

- Add `loggingActive: boolean` to `ScopeStoreState` in `scopeStore.ts`.
- Add a toggle button in the scope status bar or debug panel.
- When toggled off, stop sending `"append"` messages (but keep worker alive).

## Files to Create

- `src/scope/persist/logWorker.ts` — New file, OPFS worker implementation
- `src/scope/persist/` — New directory

## Files to Modify

- `src/scope/hooks/useScopeEngineManager.ts` — Worker lifecycle + periodic summary dispatch
- `src/store/scopeStore.ts` — Add `loggingActive` flag
- `src/components/layout/BottomBar.tsx` or `src/scope/ui/ScopeDebugPanel.tsx` — Toggle button

## Verification

1. Start simulation with logging enabled
2. Wait a few seconds
3. Open Browser DevTools → Application → Storage → File System → `log_YYYY-MM-DD.bin`
4. Confirm file exists with correct 20-byte records (read as binary)
5. Stop and restart simulation — confirm append to same day's file
6. Verify next day creates a new file

## Out of Scope (v1)

- **Mode 2 (Event-Triggered High-Res Logging)** — Pre/post ring buffer, threshold detection, `/events/` subdirectory
- **Log viewer UI** — File browser, timeline scrubber
- **Export/Download** — Downloading log files as CSV or binary
- **Auto-prune** — Deleting old log files beyond a retention window
