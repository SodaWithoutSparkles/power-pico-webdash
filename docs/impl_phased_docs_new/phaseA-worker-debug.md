# Phase A+B Handoff — Worker Engine + Debug Panel

Status: **DONE**. Build passes. Smoke test: Simulate/Pause/Clear cycle verified in browser.

## What shipped

### Phase A — Worker Engine Infrastructure (`src/scope/`)

| File | Purpose |
|------|---------|
| `workerTypes.ts` | Message protocol — `WorkerRequest`/`WorkerResponse` discriminated unions, `BucketedTelemetryData`, `StatusPayload` |
| `TelemetryRingBuffer.ts` | SoA ring buffer: `BigInt64Array` (timestamps) + `Float32Array`×2 (V, I). Push, binarySearch, slice, logicalCount helpers. Capacity 1M default |
| `FormatEngine.ts` | `bucketData(startTs, endTs, bucketCount)` — min-max bucketing over ring slice. `bucketDataSince()` convenience wrapper |
| `scope.worker.ts` | Web Worker entry. Owns ring, PacketParser, DualStageIntegrator, Simulator. onmessage dispatcher for all 13 message types. Status throttled to ~250ms. Bucketed data returned via transferable ArrayBuffers |
| `hysteresis.ts` | Schmitt trigger scale switching: `updateScaleDelta()` with real Δt. Tiers µA/mA/A per plan §5 table |
| `integrator.ts` | `DualStageIntegrator` (micro-accumulators avoid float drift) + `integrateRange()` single-pass over ring slice |
| `engineTypes.ts` | Updated: add `ScaleTier`, `HysteresisState`, `BucketedTelemetryData`. Keep deprecated compat aliases for old engine |

### Phase B — Verification Scaffold

| File | Purpose |
|------|---------|
| `src/store/scopeStore.ts` | Zustand store: config, status, latestData, selection, workerRef |
| `src/scope/useScopeEngineManager.ts` | React hook: creates worker, routes messages to store, exposes start/pause/clear/startSimulate/connectSerial/disconnect |
| `src/scope/ScopeDebugPanel.tsx` | Text-readout UI — status badge, buffer fill, live V/I/W, pkt/s, last TS. Buttons: Simulate, Start/Pause, Clear, Connect Serial |
| `src/components/layout/MainLayout.tsx` | Wired ScopeDebugPanel replacing DrawingCanvas (interim) |

### Key decisions
- Worker uses `self.postMessage(...)` with `Transferable[]` for zero-copy bucket transfer
- Ring buffer uses `BigInt64Array` for timestamps (per plan), converted to `Number` for postMessage payloads
- Status pkt/s computed by dividing packet count by actual elapsed ms since last emit
- `lastStatusTs` initialized on init to avoid spiking on first emit
- Old engine compat types kept as `@deprecated` aliases so `ScopeEngine.ts`/`AveragingBuffer.ts`/`DisplayRingBuffer.ts` still compile (Phase E deletes them)

## Verification
```
npm run build    → 1732 modules, worker bundles at ~9 KB
npm run dev      → Scope Debug Panel loads
  Click Simulate → live V/I/W climb, pkt/s ~60-100, buffer % fills
  Click Pause    → ingestion stops, values freeze
  Click Clear    → counters reset to 0
  Build          → production build succeeds
```

## Next (Phase C)
See `new-plan-detailed.md` — UI Redesign + Canvas Graph. Repurpose layout components, build ScopeCanvas Canvas 2D renderer, Measurements panel.
