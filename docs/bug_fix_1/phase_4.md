# Phase 4: Region Stats + CSV Export

Implements Steps 4+6 from `pending-issues.md` (§4 Selection-based region stats, §6 CSV export).

## Summary

### Region stats enhancement
Drag-selection now computes per-series avg/min/max in addition to energy/charge. Display shows T+start, T+end, elapsed time, and per-channel stats (when data exists and channel enabled).

### CSV export
Export selected region as CSV: timestamp, voltage, current, power. Header comment includes zero offsets. Timestamped filename. Button in Measurements panel (region section).

## Files Changed

### 1. `src/scope/engineTypes.ts`
- Added `RegionStats` interface with `energyJ`, `chargeC`, per-series `v/i/w Avg/Min/Max`.

### 2. `src/scope/ScopeEngine.ts`
- `computeRegion()` now returns `RegionStats` instead of `{ energyJ, chargeC }`.
- Accumulates sum/count/min/max per channel across in-range points.

### 3. `src/store/scopeStore.ts`
- `RegionSelection` expanded with stats fields.
- `setRegion` spreads `engine.computeRegion(...)` into region state.

### 4. `src/scope/Measurements.tsx`
- Region section: replaced `Δt` with T+start, T+end, Elapsed rows.
- Added per-channel avg/min/max rows (V/I/W), using live display units.
- Separator lines between time block, channel block, energy-charge block.
- Added `Download` button (next to Eraser) for CSV export when region active.

### 5. `src/scope/csvExport.ts` (new)
- `exportRegionCSV(engine, tStartUs, tEndUs, vZeroOffsetV, iZeroOffsetA)` — filters snap to region, writes CSV with header comments and `timestamp_us,voltage_V,current_A,power_W` columns, triggers `scope_export_YYYY-MM-DD_HH-MM-SS.csv` download.

## Acceptance Criteria

1. `tsc --noEmit` clean.
2. 23/23 tests pass.
3. Region shows T+start/T+end/Elapsed + V/I/W avg/min/max.
4. Export button downloads CSV with correct data and zero-offset header.

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass
