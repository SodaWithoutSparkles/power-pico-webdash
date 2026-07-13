# Phase 2: Unit Auto-Range, Per-Series Y-Axis, Calibration

Implements Steps 2-3 from `pending-issues.md` (§1 Unit auto-range, §2 Graph Y-axis, §3 Software zero calibration).

## Summary of Changes

### 1. Unit auto-range (per series) — §1
Measurements display no longer hardcodes 3dp in V/A/W. Each series has a configurable unit mode:
- **SI** (default): auto-switch uV/mV/V, uA/mA/A, uW/mW/W with hysteresis to prevent flapping at boundaries.
- **Off**: user picks a fixed unit from dropdown.
- **Meter**: current only — follows the device's reported range (LOW→uA, MID→mA, HIGH→A). Voltage and power fall back to SI.

Engine exports: `autoVoltageUnit`, `autoCurrentUnit`, `autoPowerUnit`, `toUnitValue`.

### 2. Per-series Y-axis — §2
Replaced single shared `vScale` with three independent Y scales (`vYScale`, `iYScale`, `wYScale`):
- Each scale has `auto` toggle + manual `min`/`max` bounds.
- uPlot uses three named scales (`yV`, `yI`, `yW`) with V on left axis, I+W on right.
- Auto-range per scale in rAF loop — each channel independently fits visible data with 10% padding.
- Wheel zoom: left gutter→V, right gutter→I+W (ponytail: Y gutter drag affects V only).
- Settings UI: per-series auto checkbox + min/max number inputs with channel color labels.

### 3. Calibration UI — §3
- New "Calibration" category in Settings sidebar.
- Engine method `calibrate(channel)` polls ring buffer on rAF for `calibrationTimeSec` seconds, returns mean, accumulates onto existing offset.
- Calibrate Voltage / Calibrate Current buttons in settings.
- Zero offset fields moved from Display category to Calibration (no duplication).
- Configurable calibration time (1–30s, default 5s).

## Files Changed

### 1. `src/scope/engineTypes.ts`
- Removed `VScale` interface.
- Added types: `UnitMode`, `VoltageUnit`, `CurrentUnit`, `PowerUnit`, `YScale`.
- `ScopeConfig`: removed `vScale`; added `vUnitMode`, `iUnitMode`, `vFixedUnit`, `iFixedUnit`, `vYScale`, `iYScale`, `wYScale`, `calibrationTimeSec`.

### 2. `src/scope/ScopeEngine.ts`
- `DEFAULT_CONFIG`: updated with all new fields (defaults: SI mode, auto Y scales, 5s cal).
- Exported helpers: `autoVoltageUnit`, `autoCurrentUnit`, `autoPowerUnit` (hysteresis-based), `toUnitValue`.
- `setConfig`: handles all new fields.
- `calibrate(channel)`: rAF-polling mean over `calibrationTimeSec`.

### 3. `src/store/scopeStore.ts`
- New actions: `setVUnitMode`, `setIUnitMode`, `setVFixedUnit`, `setIFixedUnit`, `setVYScale`, `setIYScale`, `setWYScale`, `setCalibrationTimeSec`, `calibrate`.
- `calibrate` accumulates offset: `new = existing + measuredMean`.

### 4. `src/scope/Measurements.tsx`
- Uses `autoVoltageUnit`/`autoCurrentUnit`/`autoPowerUnit` with `useRef` for hysteresis across renders.
- Values converted via `toUnitValue`; decimals adapt to unit prefix (u→1, m→2, base→3).
- Meter mode shows LOW/MID/HIGH badge.
- Energy (session + region) auto-ranges within chosen camp (J/kJ or mWh/Wh/kWh) via inline helpers.

### 5. `src/scope/ScopeSettings.tsx`
- Added "Calibration" category with `Wrench` icon.
- Display category: replaced old "Vertical scale" with per-series Y-scale settings (auto + min/max per channel).
- Added unit mode grid (Voltage/Current selects with conditional Fixed-unit sub-selects).
- Zero offsets moved to Calibration category.
- Calibrate buttons call store's `calibrate('v'|'i')`.

### 6. `src/scope/useScopeEngine.ts`
- uPlot scales: `yV`, `yI`, `yW` built dynamically per enabled channels.
- Axes: V on left (side 1), I+W on right (side 3), each with channel color.
- Series: each channel assigned to its named scale.
- Wheel zoom: left gutter→`yV`, right gutter→`yI`+`yW`.
- Y gutter drag: `yV` only (ponytail: primary left axis).
- rAF loop: independent auto-range per enabled channel.
- Per-scale `useEffect` for manual min/max application.

## Data Flow

```
ScopeConfig
  ├── vUnitMode / iUnitMode → Measurements.tsx chooses unit per mode
  │     ├── auto*Unit() helper + useRef hysteresis
  │     ├── toUnitValue() for display conversion
  │     └── meter mode reads snap.range[last] → LOW/MID/HIGH
  │
  ├── vYScale / iYScale / wYScale → useScopeEngine.ts
  │     ├── uPlot scales: yV, yI, yW
  │     ├── rAF auto-range per channel
  │     ├── manual min/max via useEffect
  │     └── wheel zoom per-side
  │
  └── calibrationTimeSec / vZeroOffsetV / iZeroOffsetA → ScopeSettings.tsx
        └── calibrate(channel) → engine.calibrate() → accumulate offset
```

## Edge Cases Handled

- **Mode switch resets hysteresis ref**: when unit mode changes (SI→Off), the unit ref resets to a sensible default so hysteresis doesn't carry over stale state.
- **Meter mode fallback**: voltage has no range switch firmware-side; `meter` mode for V falls back to SI.
- **Range 0**: treated as 'A' for current meter mode (no range data or voltage trace).
- **Disabled channels**: scales and axes only built for enabled channels. rAF auto-range skips disabled channels.
- **Config migration**: old `vScale` in localStorage is ignored; new fields use defaults if absent.

## Acceptance Criteria

1. `tsc --noEmit` passes clean.
2. `vite build` succeeds.
3. 23/23 tests pass.
4. Measurements display shows auto-ranged units (not hardcoded V/A/W).
5. V and I have independent Y axes on graph (left vs right).
6. Settings has unit mode selectors per series.
7. Settings has per-series Y-scale auto/manual controls.
8. Calibration button collects samples and updates zero offset.
9. Wheel zoom left gutter zooms V, right gutter zooms I+W.

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass (no new tests added — existing tests cover engine correctness)
- **Test runner**: `npx tsx --test "src/scope/*.test.ts"`

## Deferred to Later Phases

- Link scales (dropped for this phase — low value)
- Out-of-range notification (one per series, non-spamming)
- Per-range calibration for current (advanced manual key-in for LOW/MID/HIGH)
- Visual window band (§7a) + W-off-by-default (§7b)
