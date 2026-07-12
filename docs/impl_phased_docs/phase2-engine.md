# Phase 2 Handoff — Engine (main-thread, 3 buffers)

Status: **DONE**. Tests green (10 engine + 10 decode = 20/20).

## What shipped

Phase 2 builds the ingestion + buffering engine. Pure, DOM-free core split
into small modules so the React layer (Phase 3/4) only wires lifecycle.

### Files
- `src/scope/engineTypes.ts` — shared types: `ScopeConfig`, `ScopeStatus`,
  `DisplayPoint`, `DisplaySnapshot`, `ScopeMode`, callback aliases. No deps.
- `src/scope/DisplayRingBuffer.ts` — preallocated `Float64Array` ring (size N).
  Scrolling overwrite (oldest dropped). `snapshot()` returns chronological
  `Float64Array`s ready for uPlot. `resize()` keeps the most recent points.
- `src/scope/AveragingBuffer.ts` — FIFO of last `k` packets (matches decode.py
  `deque(maxlen=20)`). Emits one averaged `DisplayPoint` per packet once full;
  `v`/`i` averaged across all samples in window, `w = v*i`.
- `src/scope/simulate.ts` — `Simulator`: synthetic sine-V + noisy-I packets at
  `pktRateHz`. Lets the scope run with no hardware.
- `src/scope/ScopeEngine.ts` — orchestrator. Pipeline:
  `read chunks → PacketParser → AveragingBuffer(k) → DisplayRingBuffer(N)`.
- `src/scope/ScopeEngine.test.ts` — 10 cases (zero-dep, strip-types).

### Engine API (`ScopeEngine`)
- `connect()` — feature-detect `'serial' in navigator`; `getPorts()[0]` for
  reconnect else `requestPort()`; `port.open({ baudRate })`. Read-only.
- `start() / pause() / clear() / disconnect()`.
- `setConfig({ baudRate, avgSize, windowSize, channels })` — live resize of
  averaging window and display ring.
- `onStatus(cb) / onError(cb)` — throttled status (pkt/s computed over 1s
  windows; live V/I/W from latest averaged point).
- `setTZero(rawTsUs) / resetTZero()` — T+0 offset subtracted from raw device
  timestamps for display.
- `pushPacket(pkt)` — feed a decoded packet directly (tests / future sources).
- `snapshot()` — `DisplaySnapshot` for the render loop.

### T+0 + discontinuity guard
- `tZeroOffsetUs` stored as `number` (consistent with decode.ts).
- On ingest: if `rawTs < lastRawTs - 1_000_000` (backward jump > 1s = device
  reboot / counter wrap), shift `tZeroOffsetUs += lastRawTs - rawTs` so the
  displayed trace stays continuous. No vendor checks.

### Simulate mode
- `start()` with no serial port (or after `clear`) runs `Simulator` via
  `setInterval` at `pktRateHz`. Status `mode: "simulate"`.

## Decisions / notes
- **No Web Worker** — ~11.5 KB/s, main thread is fine (per plan).
- **Strip-only TS constraint**: Node's `--experimental-strip-types` rejects
  parameter properties (`constructor(public x)`). All engine classes use
  explicit field declarations + assignment. Tests import with `.ts` extension
  (required by Node ESM resolution).
- `DisplayRingBuffer.resize` keeps the **most recent** points (not oldest) —
  correct for a scrolling window that shrinks.
- `pktPerSec` is computed over a rolling 1s window, not per-call, to avoid
  noisy status churn.

## Next (Phase 3 — Store)
- `src/store/scopeStore.ts` (zustand): config + status + two integrator tiers
  (session + drag-region) + `tZeroOffsetUs`. Engine already exposes
  `setTZero`/`resetTZero` and `snapshot()`; store just mirrors status via
  `onStatus` and calls `setConfig`/`start`/`pause`/`clear`.
- Engine `liveV/I/W` + `sampleCount` feed session integrators (energy J/Wh,
  charge C/mAh) — accumulate per sample, resettable without stopping.

## Files touched
- `src/scope/engineTypes.ts` (new)
- `src/scope/DisplayRingBuffer.ts` (new)
- `src/scope/AveragingBuffer.ts` (new)
- `src/scope/simulate.ts` (new)
- `src/scope/ScopeEngine.ts` (new)
- `src/scope/ScopeEngine.test.ts` (new)

## Verification
```
node --test --experimental-strip-types src/scope/ScopeEngine.test.ts src/scope/decode.test.ts
```
All 20 pass.
