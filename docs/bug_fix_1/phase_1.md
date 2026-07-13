# Phase 1: Data Model + Ingestion Plumbing

Implements Step 1 from `pending-issues.md` implementation order. This is pure
plumbing — no UI changes, no calibration UI, no graph changes. Unblocks every
subsequent phase.

## Summary of Changes

1. **Carry range through DisplayPoint** — `range` (LOW=1, MID=2, HIGH=3) flows
   from raw `Sample`, through `AveragingBuffer`, into `DisplayRingBuffer`, into
   `DisplaySnapshot`. Winner rule: when averaging window spans a range switch,
   the latest sample's range wins.
2. **Software zero at ingestion** — per-series offsets (`vZeroOffsetV`,
   `iZeroOffsetA`) subtracted from averaged `v`/`i` in `ScopeEngine.ingest()`,
   before push to ring. All downstream consumers (graph, region stats, wattage,
   detectors) see zeroed data automatically.
3. **Config: `pktPerSec` + `bufferSec`** — user configures time in seconds and
   nominal packet rate. Engine derives `bufferSize = round(pktPerSec * bufferSec)`.
   Existing `bufferSize` removed from config; becomes internal derived value.
4. **Energy camp setting** — single config value `'joules' | 'watt-hours'`.
   No display changes yet; just stored for later phases.

## Files Changed

### 1. `src/scope/engineTypes.ts`

**DisplayPoint** — add `range: number` field.
```
{ t: number, v: number, i: number, w: number, range: number }
```
`range = 0` means "no range" (voltage, or old data before this change).
Only meaningful for current series.

**DisplaySnapshot** — add `range: Float64Array` field.
```
{ t: Float64Array, v: Float64Array, i: Float64Array, w: Float64Array, range: Float64Array }
```

**ScopeConfig** — add new fields:
- `pktPerSec: number` — nominal packet rate (default 1000)
- `bufferSec: number` — ring buffer duration in seconds (default 5)
- `vZeroOffsetV: number` — software zero for voltage (default 0)
- `iZeroOffsetA: number` — software zero for current (default 0)
- `energyCamp: 'joules' | 'watt-hours'` — energy display unit (default `'joules'`)

Remove `bufferSize: number` from `ScopeConfig` (becomes derived internally).

### 2. `src/scope/AveragingBuffer.ts`

**`average()` method** — after summing v/i across all samples, determine the
winning range:
- Iterate all packets, track the latest (by timestamp) sample's range
- Last sample of last packet is the latest (packets and samples are in order)
- Store `winnerRange: number = 0` (0 = no range, for voltage-only or edge cases)
- Return `{ t, v, i, w, range: winnerRange }`

Winner rule per spec: "when an averaging window spans a range switch, the latest
switched value wins (the meter's internal logic wanted to switch, so the most
recent decision is authoritative)."

No range or 0 range → `winnerRange = 0`. Decode layer always sets range to
LOW/MID/HIGH, so this only matters for tests or future sources.

### 3. `src/scope/DisplayRingBuffer.ts`

Add range storage and snapshot:
- Constructor: `this.range = new Float64Array(capacity)` (parallel to v/i/w)
- `push(p)` — `this.range[this.head] = p.range`
- `snapshot()` — copy range into `DisplaySnapshot.range`
- `resize(capacity)` — reallocate range array, preserve range in `this.push()` loop
- `clear()` — no range-specific reset needed (count/head reset covers it)

Existing `this.push()` call in `resize()` uses `{ t, v, i, w }` object literal.
Must add `range` to that literal. But `range` is not on the current `DisplayPoint`
interface — will be added in step 1, so this compiles after the type change.

### 4. `src/scope/ScopeEngine.ts`

**Config changes:**
- `DEFAULT_CONFIG` — add new fields (`pktPerSec: 1000`, `bufferSec: 5`,
  `vZeroOffsetV: 0`, `iZeroOffsetA: 0`, `energyCamp: 'joules'`).
  Remove `bufferSize`.
- `constructor()` — derive `bufferSize` from `bufferSec * pktPerSec`:
  `const bufferSize = Math.round(this.config.pktPerSec * this.config.bufferSec);`
  Pass to `new DisplayRingBuffer(bufferSize)`.
- `setConfig(patch)` — when `bufferSec` or `pktPerSec` changes, derive new
  `bufferSize` and call `this.ring.resize(newBufferSize)`.

**Software zero at ingestion (`ingest()` method):**

After averaging produces `point`, before pushing to ring:
```
point.v = point.v - this.config.vZeroOffsetV;
point.i = point.i - this.config.iZeroOffsetA;
point.w = point.v * point.i;  // recompute wattage with zeroed values
```

This happens at line ~296, after `const point = this.avg.push(pkt)` and before
the `displayT` calculation.

Important: apply zero AFTER averaging, not per-sample in `AveragingBuffer`.
This keeps averaging independent of zero config.

**Range propagation in `ingest()`:**

After zero application, push to ring:
```
this.ring.push({ t: displayT, v: point.v, i: point.i, w: point.w, range: point.range });
```

**Session integrators:**
- Energy and charge integration already uses `point.w` and `point.i` (both zeroed).
  No changes needed — integration sees zeroed data automatically.
- `computeRegion()` iterates `snap.w` and `snap.i` from ring buffer (already zeroed).
  No changes needed.

**`emitStatus()`:**
- Add `bufferSec` and `pktPerSec` to status? No — these are config, not status.
  Status stays as-is.

### 5. `src/store/scopeStore.ts`

**`DEFAULT_CONFIG`:**
- Replace `bufferSize: 5000` with `pktPerSec: 1000` and `bufferSec: 5`
- Add `vZeroOffsetV: 0`, `iZeroOffsetA: 0`, `energyCamp: 'joules'`

**`setConfig` — no changes needed.** Already forwards patch to engine then
updates local config. New fields flow through automatically.

**New store actions (plumbing for future UI):**
- `setVZeroOffset(offset: number)` — calls `engine.setConfig({ vZeroOffsetV: offset })`
- `setIZeroOffset(offset: number)` — calls `engine.setConfig({ iZeroOffsetA: offset })`
- `setEnergyCamp(camp: 'joules' | 'watt-hours')` — calls `engine.setConfig({ energyCamp: camp })`
- `setBufferSec(sec: number)` — calls `engine.setConfig({ bufferSec: sec })`
- `setPktPerSec(rate: number)` — calls `engine.setConfig({ pktPerSec: rate })`

Each action: one-liner calling `engine.setConfig(...)` then `set({ config: {...} })`.
Ponytail: could skip individual setters and just use `setConfig` directly from UI,
but dedicated setters avoid boilerplate in every UI component that touches these.
Verdict: add them — each is 2 lines, saves more downstream.

### 6. `src/scope/simulate.ts`

Already sets `range: LOW_CUR` on all samples. No changes needed.

### 7. `src/scope/ScopeEngine.test.ts`

Must be updated:
- `AveragingBuffer` tests — verify `range` field in returned `DisplayPoint`
- Simulator tests — already pass (simulate sets range)
- `displayRingBuffer` tests — verify range preserved through push/snapshot/resize
- New tests: software zero subtraction, range winner rule

### 8. `src/scope/useScopeEngine.ts`

**uPlot data handoff** — `snapshot()` now returns 5 Float64Arrays (`t,v,i,w,range`).
uPlot doesn't need `range`. No change to `setData` call — destructure only what's needed,
ignore range. Snap already separated; range is extra field, silently ignored.

**Y-axis auto-range** — scans `snap.v`, `snap.i`, `snap.w`. No range dependence.
No changes needed.

### 9. `src/scope/Measurements.tsx`

No changes needed. Software zero is already applied to `liveV`, `liveI`, `liveW` in
engine. Measurements displays them as-is. Unit auto-range comes in Phase 2.

### 10. `src/scope/ScopeSettings.tsx`

Replace `bufferSize` input with `bufferSec` slider/input:
- Label: "Buffer (seconds)"
- Min: 1, Max: 60, Step: 1
- Show derived `bufferSize = round(pktPerSec * bufferSec)` as helper text
- `pktPerSec` input: label "Packets/sec", default 1000, min 100, max 10000
- On change: `setConfig({ bufferSec: val })` which triggers engine resize

Remove `bufferSize` from settings UI entirely.

Energy camp setting: add radio group "Joules" / "Watt-hours" (simple toggle,
no conversion yet).

Software zero fields: V Zero (V), I Zero (A) — number inputs with step 0.001.
Labeled "Voltage zero offset" and "Current zero offset". No calibration button
yet (comes in Phase 2).

### 11. `src/scope/ScopeStatusBar.tsx`

No changes needed for Phase 1. `pktPerSec` already displayed.

## Files NOT Changed (Phase 1)

- `decode.ts` — range already in `Sample`, no changes
- `useScopeEngine.ts` — no ingestion changes, uPlot handoff unchanged
- `ScopeView.tsx` — no changes
- `ScopeHeader.tsx` — no changes
- `ScopeToolbar.tsx` — no changes
- `QuickSettings.tsx` — no changes (horizontal zoom still works in seconds)
- `Measurements.tsx` — no changes (unit display comes in Phase 2)
- `components/` — no changes

## Data Flow After Changes

```
Firmware/Sim → DecodedPacket { samples: [{ range, volts, amps }] }
     │
     ▼
AveragingBuffer.average()
     → sum v, sum i, winner = latest range
     → DisplayPoint { t, v, i, w, range }
     │
     ▼
ScopeEngine.ingest()
     → v -= vZeroOffsetV
     → i -= iZeroOffsetA
     → w = v * i          <-- recomputed with zeroed v, i
     → displayT = point.t - tZeroOffsetUs
     ▼
DisplayRingBuffer.push({ t: displayT, v, i, w, range })
     ▼
DisplayRingBuffer.snapshot() → { t, v, i, w, range }
     │
     ├──► rAF loop → uPlot (range ignored)
     ├──► Session integrators (W, I — already zeroed)
     ├──► computeRegion (W, I from snap — already zeroed)
     └──► Measurements.tsx (live V/I/W — already zeroed)
```

## Edge Cases

### Range
- **Range switch mid-window**: Winner rule picks latest. This is correct per spec —
  the meter's most recent decision is authoritative.
- **All samples have same range**: Winner is that range. Trivial.
- **No range (0)**: voltage-only traces, or data from before this change. Treated
  as "no range" — UI in Phase 2 handles this gracefully.
- **Range in DisplayRingBuffer resize**: `resize()` pushes DisplayPoint objects.
  Old code push uses `{ t, v, i, w }` literal; must add `range` to keep data
  across resize.

### Software Zero
- **Zero offset changes mid-session**: New offset applies to new points only.
  Old points in ring keep their original (already-zeroed) values. This is correct —
  changing zero shouldn't retroactively alter history.
- **Negative zero**: Valid — if sensor reads positive at 0A, offset can be negative
  to bring it to 0.
- **Wattage recompute**: After zeroing v and i, recompute `w = v * i`. Ensure this
  matches spec definition: `w = v * (i - iZeroOffsetA)` — but v is also zeroed?
  Spec says "w = v * (i - iZeroOffsetA)" which suggests only i gets zeroed for W.
  Actually: v also gets zeroed since the spec says "per-series offset subtracted
  from raw value." So w uses zeroed v AND zeroed i. The formula in §7b is a
  simplification for the wattage series; in practice w = zeroed_v * zeroed_i.

### Config
- **bufferSize derivation**: `Math.round(pktPerSec * bufferSec)`. Round to integer.
  Minimum 1 (prevent empty ring).
- **Config migration**: users with existing localStorage config will have
  `bufferSize` but not `pktPerSec`/`bufferSec`. Need migration: if `bufferSize`
  exists but `bufferSec` doesn't, derive `bufferSec = bufferSize / pktPerSec`.
  Or just use defaults on first load — simpler. Ponytail: use defaults, config
  is ephemeral anyway.

## Acceptance Criteria

1. `npm run build` succeeds (TypeScript compiles clean).
2. Existing tests pass: `npx vitest run`. Update tests as needed for changed
   interfaces.
3. New AveragingBuffer test: range winner rule verified (latest range wins for
   multi-range window).
4. New DisplayRingBuffer test: range preserved through push → snapshot → resize.
5. New engine test: software zero subtracted from v/i; w recomputed correctly.
6. Simulate mode runs: V/I/W values display as before (zero offsets at 0 — no
   visible change until offsets are set in Phase 2).
7. Settings UI: bufferSec input replaces bufferSize; derived bufferSize shown;
   pktPerSec input present; energy camp radio; zero offset fields (read-only for now).

## Deferred to Later Phases

- Calibration UI (auto-calibrate button, calibration timer, per-range offsets)
- Unit auto-range display (SI/meter modes)
- Graph Y-axis per-series + manual override
- Zoom/scroll UX changes
- Region stats unit display within energy camp
- Everything else in `pending-issues.md` phases 2-7

## Dependencies

No new npm deps. All changes are internal TypeScript.

## Estimated Impact

- ~8 files changed
- ~100-150 LOC net added
- No breaking changes to external interfaces (store API additions only)
- Backward compatible: existing config fields work with defaults for new fields

## Review Findings (2026-07-14)

Issues found and resolved:

1. **[critical] Fixed** — `bufferSize = Math.round(...)` could produce 0 for degenerate
   pktPerSec/bufferSec values, causing `% 0` crash in DisplayRingBuffer. Added
   `Math.max(1, ...)` guard in constructor and `setConfig()`.

2. **[major] Fixed** — Missing test for range winner rule with `avgSize > 1`.
   Added `ScopeEngine: range winner rule with avgSize > 1 (latest range wins)`.

3. **[major] Fixed** — `DisplayRingBuffer.resize` test didn't assert range survived
   resize. Added `assert.deepEqual(Array.from(s.range), [3, 4, 5])`.

4. **[major] Fixed** — `setConfig()` silently ignored `vScale`, `hZoomSec`, `vZoom`,
   `followLatest`. Added forwarding for all four fields.

5. **[minor] Fixed** — `DEFAULT_CONFIG` duplicated in `ScopeEngine.ts` and
   `scopeStore.ts`. Exported from engine, imported in store. Single source of truth.

6. **[minor] Fixed** — `getConfig()` returned direct mutable reference. Now returns
   shallow copy `{ ...this.config }`.

**Not fixed (pre-existing, out of Phase 1 scope):**
- Session integrators use rectangular integration vs trapezoidal in `computeRegion()`.
  Minor discrepancy; fix if precision matters later.
- `bufferSec`/`pktPerSec` assigned unconditionally in setConfig (unlike `avgSize`
  which checks for change). Cosmetic.
- Discontinuity guard: forward large gaps are not treated as discontinuities
  (correct behavior — shows flat line, not reset).

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass (11 existing + 2 new from plan + 2 new from review fixes)
- **Test runner**: `npx tsx --test "src/scope/*.test.ts"`
