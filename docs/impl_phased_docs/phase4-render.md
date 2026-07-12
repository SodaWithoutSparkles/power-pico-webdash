# Phase 4 Handoff — Render (uPlot, rAF-decoupled)

Status: **DONE**. `tsc --noEmit` clean. `vite build` succeeds (uPlot ESM +
CSS resolve). Engine tests untouched (20/20 still green from Phase 2/3).

## What shipped

Phase 4 adds the render surface. A single uPlot instance is owned by
`useScopeEngine` and fed by a `requestAnimationFrame` loop that reads
`engine.snapshot()` — fully decoupled from serial ingestion (engine buffers,
loop only reads).

### Files
- `src/scope/useScopeEngine.ts` — new. Owns uPlot lifecycle + rAF loop +
  drag-select + wheel zoom + region band overlay.
- `src/scope/ScopeView.tsx` — new. Thin shell: ref div hosting the chart,
  rebuilds on channel-set change.
- `src/components/layout/MainLayout.tsx` — center swapped from `DrawingCanvas`
  to `<ScopeView/>`. Header/Left/Right/Bottom still the drawing shell (removed
  in Phase 6).

### Render loop
- `requestAnimationFrame` pulls `getEngine().snapshot()` → builds
  `uPlot.AlignedData` (`[t, ...enabledChannels]`) → `u.setData(data, false)`.
  `resetScales=false` preserves user zoom across frames.
- x = display-time (us), already T+0 offset by the engine. x-axis formatter
  shows elapsed **seconds** (`t/1e6`). One series per enabled channel
  (cyan V / amber I / violet W).

### Drag-to-select region
- uPlot `cursor.drag: { x: true, y: false, setScale: false }` — horizontal
  drag only, no zoom. `select.show: false` hides uPlot's own box.
- `setSelect` hook → `posToVal` on drag edges → `setRegion(t0, t1)` (store
  computes energy/charge via `engine.computeRegion`).
- Region band drawn via `drawClear` hook: shaded rect from `tStartUs`→`tEndUs`
  using `valToPos`, read from a `regionRef` (kept current via effect).
- **Esc** → `clearRegion()`. New drag replaces the previous selection.

### Zoom
- `wheelZoomPlugin` (uPlot has no native wheel zoom): wheel over plot zooms x
  and y about the cursor; double-click resets to auto-range. `passive:false`
  + `preventDefault` so the page doesn't scroll.

### Channel toggles
- uPlot fixes series count at construction, so the chart **rebuilds** when the
  enabled-channel set changes. `ScopeView` derives a `channelKey`
  (`"viw"`-style) from `config.channels` and passes it as the effect dep.
  Rebuild tears down the old instance (cancel rAF, disconnect ResizeObserver,
  `destroy()`) and starts fresh.

### Resize
- `ResizeObserver` on the container → `u.setSize({ width, height })`. Container
  is `absolute inset-0` inside a `flex-1 relative` parent so it fills the
  center area.

## Decisions / notes
- **One uPlot instance, owned by the hook.** No React state per frame — the rAF
  loop reads `useScopeStore.getState()` directly (no re-render churn). Status
  throttling (Phase 3) stays in the store; the render loop is separate.
- **Region = display-time range** (matches Phase 3 store contract). The
  `drawClear` band uses `valToPos` on the same x-scale the user dragged on, so
  it stays aligned under zoom/scroll.
- **`setData(data, false)`** — `resetScales=false` keeps zoom stable while the
  trace scrolls. Auto-range only on first paint / dblclick reset.
- **Wheel zoom is a small custom plugin**, not a dep — uPlot deliberately omits
  it. ~30 lines, no library. (ponytail: don't pull a zoom plugin for this.)
- **uPlot CSS** imported via `import "uplot/dist/uPlot.min.css"` in
  `ScopeView` (Vite resolves it; build confirms).
- **`verbatimModuleSyntax`** is on, so `uPlot` is imported as default value
  (`import uPlot from "uplot"`), not type — types come from the same module via
  `uPlot.Options` namespace syntax. Build + tsc both pass.

## Next (Phase 5 — UI shell)
- `ScopeSettings.tsx` (right panel): baud, avg `k`, window `N`, channel
  checkboxes, vertical scale (auto/manual), horizontal zoom, Connect/Simulate,
  Start/Pause, Clear, collapse. Reads/writes `useScopeStore.config`.
- `ScopeStatusBar.tsx` (bottom): Run/Stop, pkt/s, sample count, buffer fill %,
  last ts, live V/I/W. Replaces drawing `BottomBar`.
- `Measurements.tsx`: live V/I/W + session integrators (J/Wh, C/mAh) + region
  readout (Δt, energy, charge). Replaces drawing `RightSidebar` content.
- `LeftSidebar` → scope channel/measure toolbar (replaces drawing tools).
- `Header` → scope menus (Connect, Simulate, Set T=0, Reset). Replaces drawing
  File/Edit/Options/Help menus.
- Route `engine.onError` to `NotificationCenter` (Phase 3 currently
  `console.error`s). NotificationCenter reads the old `useStore` — either
  repurpose it to read `useScopeStore` or add a tiny scope-native notifier.

## Open questions / handoff flags
- **Region band under heavy zoom**: `drawClear` redraws every frame; cheap
  (one rect). Fine at current rates. Revisit only if perf ever matters.
- **Wheel zoom vs drag-select conflict**: wheel = zoom, drag = select. Both on
  `.u-over`. No conflict (different gestures). Confirmed in build; needs a
  manual browser pass in Phase 5.
- **Channel rebuild loses zoom**: toggling a channel rebuilds the chart and
  resets zoom. Acceptable (rare action). Could persist scale limits across
  rebuild if annoying — flag for Phase 5 UX test.

## Files touched
- `src/scope/useScopeEngine.ts` (new)
- `src/scope/ScopeView.tsx` (new)
- `src/components/layout/MainLayout.tsx` (edited: center → ScopeView)

## Verification
```
npx tsc --noEmit          # clean
npx vite build            # uPlot ESM + CSS resolve, 1738 modules
node --test --experimental-strip-types src/scope/ScopeEngine.test.ts src/scope/decode.test.ts
# 20/20 still green (engine untouched)
```
Manual (Phase 5, needs browser + Web Serial secure context):
- Click Simulate → traces scroll; status = Run.
- Drag on chart → shaded band + region readout; Esc clears.
- Wheel over plot → zoom; dblclick → reset.
- Toggle a channel → chart rebuilds with new series set.
