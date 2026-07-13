# Phase 3 Handoff — Store (zustand, engine-owned)

Status: **DONE**. Engine tests still green (20/20). Store compiles under `tsc`.

## What shipped

Phase 3 adds the state layer. A single `ScopeEngine` instance is owned by the
store module (one engine for the whole app — no provider/context needed). The
store is the **sole UI API**: components read status/config from it and call
its actions; they never touch the engine directly except for the render loop's
`snapshot()` (via `getEngine()`).

### Files
- `src/store/scopeStore.ts` — new. zustand store owning the engine singleton.
- `src/scope/engineTypes.ts` — extended `ScopeStatus` with `sessionEnergyJ`,
  `sessionChargeC`, `tZeroOffsetUs`.
- `src/scope/ScopeEngine.ts` — added session integrators, T+0 mirror, region
  compute, and status fields (see below).

### Store API (`useScopeStore`)
- `config` + `setConfig(patch)` — mirrors to engine (`setConfig` live-resizes
  averaging window + display ring). Defaults: baud 115200, avg 10, window 1000,
  channels V/I/W all on.
- Status (throttled to ~10 Hz): `running`, `mode`, `pktPerSec`, `sampleCount`,
  `bufferFillPct`, `lastTimestampUs`, `liveV/I/W`, `sessionEnergyJ/C`,
  `tZeroOffsetUs`.
- T+0: `setTZero()` (mark latest raw ts as origin), `resetTZero()`.
- Session integrators: `resetSessionIntegrators()` (zeroes without stopping).
- Region: `region: { tStartUs, tEndUs, energyJ, chargeC } | null`,
  `setRegion(tStartUs, tEndUs)`, `clearRegion()`. Region is stored as a
  **display-time range**, not ring indices — robust to ring scrolling/resize.
- Lifecycle: `connect()`, `start()`, `pause()`, `clear()`, `disconnect()`.
- `getEngine()` — exposes the engine for the render loop's `snapshot()`.

## Engine additions (Phase 3)

### Session integrators (energy J, charge C)
- Accumulated per averaged point via trapezoid over display-time deltas:
  `E += w * dt`, `Q += i * dt` (dt in seconds). First point only baselines.
- `clear()` and `resetSessionIntegrators()` zero them; `lastIntegrateTUs`
  re-baselined so no spurious dt after a reset or T+0 shift.
- Persist across start/pause (engine keeps running flag; integrators untouched
  by `pause()`).

### T+0 mirror + discontinuity guard
- `tZeroOffsetUs` already in engine (Phase 2). Now mirrored into `ScopeStatus`
  so the UI can show the offset.
- `markTZero()` — UI "Set T=0" button: sets offset to latest raw ts, re-baselines
  integration. `resetTZero()` zeroes offset.
- Backward-jump guard (Phase 2) unchanged: jump > 1s shifts offset to keep the
  trace continuous.

### Region compute
- `computeRegion(tStartUs, tEndUs)` — trapezoid-integrates W and I across
  in-range points in the display ring. Returns `{ energyJ, chargeC }`.
- Called by the store's `setRegion` when the user finishes a drag on the chart
  (Phase 4 wires the uPlot drag hook → `setRegion`).

## Decisions / notes
- **One engine, owned by store module.** No React context/provider — the store
  is a module singleton, so `useScopeStore.getState().getEngine()` is available
  anywhere (render loop, hooks).
- **Status throttled to 10 Hz** in the store (not the engine) so high pkt rates
  don't thrash React. Engine still emits at its own cadence; store drops
  intermediate updates.
- **Region = display-time range, not indices.** The display ring scrolls and can
  resize; raw indices would go stale. Display-time is stable and matches the
  x-axis the user dragged on. `computeRegion` re-scans the current ring.
- **`onError` surfaced via `console.error`** for now; Phase 5 wires it to
  `NotificationCenter` (the drawing store's notification slice is being removed
  in Phase 6, so the scope needs its own error path — see Open Questions).
- **No persistence of config** yet. Plan didn't require it; localStorage wiring
  can land in Phase 5 if desired (ponytail: skip until asked).

## Next (Phase 4 — Render)
- `src/scope/ScopeView.tsx` — uPlot in a ref div; rAF loop reads
  `getEngine().snapshot()` → `uplot.setData(...)`. x = display-time (us),
  already T+0 offset by the engine. One series per enabled channel.
- Drag-to-select: uPlot `cursor.drag` hook → `setRegion(xStart, xEnd)` using the
  chart's x pixel→data mapping. Shaded band overlay for the selected region.
  Esc → `clearRegion()`.
- `src/scope/useScopeEngine.ts` — hook wiring `running` → `start/pause`, mounts
  the rAF loop, owns the uPlot instance lifecycle.

## Open questions / handoff flags
- **Error toasts**: Phase 5 must route `engine.onError` to a notification
  surface. The drawing `NotificationCenter` reads the old `useStore`; either
  repurpose it to read `useScopeStore` or add a tiny scope-native notifier.
- **Config persistence**: not implemented. Add in Phase 5 if needed.
- **Region overlay rendering**: uPlot has no native shaded-band; Phase 4 draws
  it via a `drawClear`/plugin hook or a sibling absolutely-positioned div
  computed from the drag pixel range. Flag for Phase 4.

## Files touched
- `src/store/scopeStore.ts` (new)
- `src/scope/engineTypes.ts` (edited: `ScopeStatus` fields)
- `src/scope/ScopeEngine.ts` (edited: integrators, T+0 mirror, region compute)

## Verification
```
node --test --experimental-strip-types src/scope/ScopeEngine.test.ts src/scope/decode.test.ts
# 20/20 pass
npx tsc --noEmit   # store + engine typecheck clean
```
