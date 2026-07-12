# Phase 5 Handoff — UI Shell (scope-native)

Status: **DONE**. `tsc --noEmit` clean. `vite build` succeeds (1714 modules).
Engine tests untouched (20/20 green from Phase 2/3).

## What shipped

Phase 5 replaces the drawing shell with a scope-native UI. The center
`ScopeView` (Phase 4) stays; header, left toolbar, right panel, and bottom bar
are now scope components reading/writing `useScopeStore`. Drawing components
are NOT deleted yet (that is Phase 6) — they are simply no longer mounted.

### New files
- `src/scope/ScopeHeader.tsx` — Connect / Simulate / Start / Pause / Clear /
  Set T=0. Start disabled until a source is chosen (mode != idle).
- `src/scope/ScopeToolbar.tsx` — left rail: V/I/W channel toggles (with on-dot)
  + Set T=0 button.
- `src/scope/ScopeSettings.tsx` — collapsible right panel: baud, avg `k`,
  window `N`, channel checkboxes, vertical scale (auto / manual min-max),
  horizontal zoom (s, 0 = fit). Reads/writes `config`.
- `src/scope/ScopeStatusBar.tsx` — bottom: Run/Stop dot, pkt/s, sample count,
  buffer fill %, last ts, live V/I/W.
- `src/scope/Measurements.tsx` — live V/I/W + session integrators (J/Wh, C/mAh)
  with reset + drag-region readout (Δt, energy, charge) with clear.

### Edited files
- `src/scope/engineTypes.ts` — added `VScale` + `hZoomSec` to `ScopeConfig`.
- `src/scope/ScopeEngine.ts` — added `simulate()` (enter sim mode, no ingest);
  `DEFAULT_CONFIG` carries `vScale`/`hZoomSec`.
- `src/store/scopeStore.ts` — added `notifications`/`notify`/`dismissNotification`,
  `simulate` action; engine `onError` now routes to `notify` (was console.error);
  `connect`/`simulate` emit toasts; `DEFAULT_CONFIG` carries new fields.
- `src/scope/useScopeEngine.ts` — y-axis honors `vScale` (auto vs fixed min/max);
  rAF loop pins x window to `[latest - hZoomSec, latest]` when `hZoomSec > 0`
  and the user hasn't manually wheel-zoomed (x scale still at auto).
- `src/components/common/NotificationCenter.tsx` — repurposed to read
  `useScopeStore` (was drawing `useStore`). Import aliased `ScopeNote` to dodge
  the global `Notification` DOM type clash.
- `src/components/layout/MainLayout.tsx` — center `ScopeView`; left
  `ScopeToolbar`; right column = `Measurements` + `ScopeSettings`; bottom
  `ScopeStatusBar`; top `ScopeHeader`.

## Decisions / notes
- **One store, one notifier.** `NotificationCenter` now reads `useScopeStore`.
  No second notification system. Engine errors surface as error toasts; connect
  success / simulate-ready as info/success. (ponytail: reuse, don't add.)
- **`simulate()` vs `start()`.** `simulate()` only sets mode + resets the
  simulator; `start()` begins the ingest timer. UI: pick Simulate (or Connect),
  then Start. Matches plan verification step 3.
- **Horizontal zoom is config-driven, not gesture.** `hZoomSec` pins the x
  window each frame only while the x scale is at auto (user hasn't wheel-zoomed).
  Wheel zoom still wins once engaged. (ponytail: no extra zoom UI; reuse the
  existing wheel plugin.)
- **Vertical scale** applied at chart construction via `scales.y`. Changing it
  rebuilds the chart (same effect dep path as channel toggles — `channelKey`
  didn't change, but `vScale` is read at build time, so a `setConfig` that
  changes vScale does NOT currently rebuild). Flag below.
- **Channel toggle from two places** (toolbar + settings) both write the same
  `config.channels`; store is source of truth, both stay in sync.
- **`Measurements` above `ScopeSettings`** in a single right column (no extra
  wrapper width). Collapse only affects `ScopeSettings`; `Measurements` stays.

## Open questions / handoff flags
- **vScale change doesn't rebuild chart.** `useScopeEngine` reads `vScale` at
  build time but the effect dep is `channelKey` only. Manual scale changes
  apply on next channel toggle / remount. Fix in Phase 6: include a `vScale`
  signature in the rebuild dep, or apply scale live via `u.setScale`. Prefer
  live `setScale` (no rebuild, keeps zoom).
- **hZoomSec vs wheel-zoom interaction**: once wheel-zoom sets x min/max, the
  auto-pin stops (by design). Reset via dblclick returns to auto and re-pins.
  Confirmed in code; needs browser pass.
- **Start disabled until source chosen** — if user hits Start with mode idle,
  nothing happens (button disabled). Good, but no toast explaining why. Minor.
- **Drawing code still present** (Phase 6 deletes it): `src/components/canvas/*`,
  drawing store slices, `Header`/`LeftSidebar`/`RightSidebar`/`BottomBar`,
  `common/DualColorPicker`, `ColorPicker`, `PopoverSlider`, `ToolSettingsModal`,
  `ShortcutConfigModal`, `help/HelpModal`, `layout/header/*`, `store/useStore`,
  `storeTypes`, `storeDefaults`, `storage`, `types.ts`, `utils/compress|projectName|saveProject`,
  `KeyboardShortcuts`. `NotificationCenter` + `KeyboardShortcuts` may be kept
  (KeyboardShortcuts still imports drawing `useStore` — must repurpose or drop
  in Phase 6).

## Verification
```
npx tsc --noEmit          # clean
npx vite build            # 1714 modules, no errors
node --test --experimental-strip-types src/scope/ScopeEngine.test.ts src/scope/decode.test.ts
# 20/20 green
```
Manual (browser + Web Serial secure context):
- Click Simulate → Start → traces scroll; status = Run; pkt/s > 0.
- Toggle V/I/W in toolbar or settings → series appears/disappears (rebuild).
- Change avg `k` / window `N` → trace coarsens / history grows.
- Set vertical scale manual min/max → (flag) applies on next rebuild; wheel
  zoom still works.
- Set horizontal zoom (s) → x window pins to last N seconds; dblclick resets.
- Drag on chart → shaded band + region readout (Δt, J/Wh, C/mAh); Esc clears.
- Connect to real device @115200 → live data; errors show as toasts.
- Set T=0 → x-axis relabels to elapsed from that point.

## Next (Phase 6 — cleanup)
Delete dead drawing code per plan steps 13. Repurpose or drop `KeyboardShortcuts`
(imports drawing `useStore`). Add live `vScale` application via `setScale` so
manual scale changes don't need a rebuild.
