# Plan: Power Pico Oscilloscope (Web Serial)

TL;DR — Build an oscilloscope view that ingests the Power Pico serial protocol
(header `0xAA55`, 8-byte LE timestamp, 1-byte count, 7-byte samples) over Web
Serial at configurable baud, through a 3-buffer pipeline (read accumulation →
averaging → display ring), rendered with **uPlot** in a `requestAnimationFrame`
loop decoupled from ingestion. The existing drawing app is just the template
shell; we repurpose its layout (center canvas, right panel, bottom bar, left
toolbar) for the scope. Main-thread engine (no Web Worker — overkill at
~11.5 KB/s). Read-only serial.

## Steps

### Phase 0 — Deps & types
1. Add `uplot` to `package.json` dependencies (tiny, no wrapper lib — use it
   directly via ref). *parallel with step 2*
2. Add `src/types/web-serial.d.ts` — minimal ambient declaration for
   `navigator.serial` (SerialPort, Serial, requestPort, getPorts, open,
   readable) ONLY if not already present in lib.dom. Keep it tiny.

### Phase 1 — Decode (port `references/decode.py`)
3. `src/scope/decode.ts` — pure, DOM-free:
   - Constants: `HEADER = 0xAA55`, ranges LOW/MID/HIGH, the 3 current scales
     and `VOLTS_PER_ADC_LSB` from decode.py.
   - `decodePacket(bytes): { timestampUs, samples: {volts, amps}[] }`.
   - `PacketParser` class: holds accumulation `Uint8Array`, scans for header,
     reads count, slices full packet when `count*7` bytes available; retains
     remainder. Yields complete packets. (ponytail: reuse decode.py math exactly.)
4. `src/scope/decode.test.ts` — `node --test --experimental-strip-types`
   (zero-dep) feeding synthetic bytes; assert volts/amps values and
   partial-buffer / split-across-chunks handling.

### Phase 2 — Engine (main-thread, 3 buffers)
5. `src/scope/ScopeEngine.ts`:
   - `connect()` → `navigator.serial.requestPort()` (user gesture) /
     `getPorts()` for reconnect; `port.open({ baudRate })`.
   - Read loop: `port.readable.getReader()`, append chunks to accumulation
     buffer → `PacketParser` → packets → **averaging buffer** (FIFO of `k`
     packets). When `k` reached, compute one averaged point
     `{t, v, i, w}` → push to **display ring buffer** (size `N`, preallocated,
     overwrite-oldest = scrolling).
   - `start() / pause() / clear() / setConfig({baudRate, avgSize:k,
     windowSize:N, channels})`.
   - `onStatus(cb)` → pkt/s, sampleCount, bufferFillPct, running, lastTsUs.
   - **Simulate mode**: generate synthetic packets (sine V, noisy I) instead of
     serial — enables testing without hardware.
   - Read-only: never touch `port.writable`.

### Phase 3 — Store
6. `src/store/scopeStore.ts` (zustand, separate from drawing store):
   - config: `baudRate` (def 115200), `avgSize` (def 10), `windowSize` (def
     1000), `channels {v,i,w}`, `vScale {auto,min,max}`, `hZoom`.
   - **T+0 reset** (overflow-resilient): store `tZeroOffsetUs` (int64). Engine
     subtracts this from raw device timestamps for display. Configurable via
     "Set T=0" button in settings. Engine auto-detects timestamp jumps
     backward > 1s (device reboot / counter wrap) and shifts `tZeroOffsetUs` to
     keep the trace continuous. No magic chromium/not-chromium checks — feature
     detect: `'serial' in navigator`. Show banner if missing, browser-agnostic.
   - status: `running`, `pktPerSec`, `sampleCount`, `bufferFillPct`,
     `lastTimestampUs`, `liveV/I/W`.
   - **Two energy/charge integrator tiers**:
     - **Session accumulators** — `sessionEnergyJ`, `sessionChargeC`. Accumulate
       from every sample since last reset. Reset via button (without stopping).
       Store per-integral `lastUs` to avoid double-counting across display-buffer
       wraps.
     - **Drag region integrator** — `regionEnergyJ`, `regionChargeC`,
       `regionStartIdx`, `regionEndIdx` (indices into display buffer). Populated
       by user click-drag on the uPlot chart. Compute over selected time window
       only. Cleared on new selection or Esc.
   - actions: `setConfig`, `setStatus` (throttled from engine),
     `resetSessionIntegrators`, `resetTZero`.

### Phase 4 — Render (uPlot, rAF-decoupled)
7. `src/scope/ScopeView.tsx` — create uPlot in a ref div; x-axis = time (us),
   y-axis = value; one series per enabled channel (colors from store).
   `requestAnimationFrame` loop reads engine display-buffer snapshot →
   `uplot.setData(...)`. Enable uPlot wheel zoom (vertical/horizontal). Respects
   `vScale` config + channel toggles.
   - **Drag-to-select region**: uPlot cursor.drag hook → set `regionStartIdx`,
     `regionEndIdx` on the store. Engine computes region energy/charge on demand.
     Overlay shaded band on the chart for the selected region. Esc clears.
   - **T+0 offset** applied to all displayed x-values: `x_display = x_raw - tZeroOffsetUs`.
     X-axis label shows elapsed seconds from T=0. *depends on step 5*
8. `src/scope/useScopeEngine.ts` — hook wiring engine lifecycle to store +
   ScopeView; owns the rAF loop; maps `running` → start/pause. *depends on 5,6,7*

### Phase 5 — UI shell (repurpose template)
9. `src/components/layout/MainLayout.tsx` — center → `<ScopeView/>`; right →
   `<ScopeSettings/>`; bottom → `<ScopeStatusBar/>`; left → channel/measure
   toolbar. Keep `<NotificationCenter/>` for errors (port denied, parse errors).
10. `src/scope/ScopeSettings.tsx` — **collapsible** right panel: baud input,
    avg buffer size (k), display window size (N), channel checkboxes (V/I/W),
    vertical scale (auto / manual min-max), horizontal zoom, Connect / Simulate,
    Start / Pause, Clear, collapse toggle. Reuse Tailwind + `lucide-react`
    icons (Play/Pause/Settings/Trash2). *depends on 6*
11. `src/scope/ScopeStatusBar.tsx` — bottom annunciators: Run/Stop (green/red),
    pkt/s, sample count, buffer fill %, last timestamp, live V/I/W mini-readouts.
12. `src/scope/Measurements.tsx` — two-tier readout panel:
    - **Live**: instantaneous V, I, W from latest averaged sample.
    - **Session integrators**: `sessionEnergyJ` (also Wh), `sessionChargeC` (also
      mAh). Incremented on every sample; reset via button without stopping.
    - **Region integrator**: when drag-selection active on chart, show
      `regionEnergyJ`/`regionChargeC` over that interval + `Δt` (us, ms, s as
      appropriate). Esc clears selection. *depends on 6,7*

### Phase 6 — Cleanup (delete dead drawing code)
13. Remove drawing-specific artifacts:
    - `src/components/canvas/` entire tree (DrawingCanvas, ShapeRenderer,
      TextEditorOverlay, all hooks, utils)
    - `src/store/slices/canvasSlice.ts`, `toolsSlice.ts`, `colorsSlice.ts`,
      `navigationSlice.ts`
    - `src/components/layout/LeftSidebar.tsx` (replace with scope toolbar)
    - `src/components/layout/RightSidebar.tsx` (replace with scope settings)
    - `src/components/layout/BottomBar.tsx` (replace with scope status bar)
    - `src/components/common/DualColorPicker.tsx`, `ColorPicker.tsx`,
      `PopoverSlider.tsx`, `ToolSettingsModal.tsx`,
      `ShortcutConfigModal.tsx`
    - `src/components/help/HelpModal.tsx`
    - `src/components/layout/header/` (FileMenu, EditMenu, OptionsMenu,
      HelpMenu, MenuItem)
    - `src/store/useStore.ts`, `src/store/storeTypes.ts`,
      `src/store/storeDefaults.ts`, `src/store/storage.ts`
    - `src/types.ts` (CanvasItem, shape types, SaveFile — drawing-specific)
    - `src/utils/compress.ts`, `src/utils/projectName.ts`,
      `src/utils/saveProject.ts`
    - `src/App.tsx` → simplify to `<ScopeView/>` + `<NotificationCenter/>`.
    - Keep: `NotificationCenter.tsx`, `KeyboardShortcuts.tsx` (may repurpose),
      Tailwind setup, `index.css`, `main.tsx`, `ErrorBoundary.tsx`.
    - Keep: `zustand` dep (used by scopeStore). May remove: `react-konva`,
      `konva`, `clsx` (re-evaluate; uPlot doesn't need them; `clsx` may be
      useful for UI). Remove `tailwind-merge` if no complex class merging.

### Phase 7 — Polish (User input required)
14. Test on real device @115200 baud; verify live traces, session integrators,
15. Themes (dark/light), responsive layout, and accessibility (ARIA labels, keyboard navigation, color contrast). Ensure the UI is intuitive and user-friendly.

## Phase 8 — Docs
15. Update README.md with quick start instructions, screenshots, and feature list.
16. Proper documentation of the protocol, including packet structure, timestamp handling, and energy/charge calculations.

## Phase 9 — i18n Support (deferred)
17. Add i18n support, primarily for zh-CN, en-US locals. Use `react-i18next` or similar library to manage translations. Ensure all UI text is translatable and provide a mechanism for users to switch languages.

## Relevant files
- `references/decode.py` — source of truth for protocol + scaling math.
- `src/components/layout/MainLayout.tsx` — swap drawing components for scope.
- `src/store/useStore.ts` — drawing store; left intact or deleted in Phase 6.
- `src/components/common/NotificationCenter.tsx` — reuse for error toasts.
- `package.json` — add `uplot`.

## Verification
1. `npm install` (pulls uplot).
2. `node --test --experimental-strip-types src/scope/decode.test.ts` → decode passes.
3. `npm run dev` → open localhost in any supporting browser (need secure context
   for Web Serial). Click **Simulate** → traces scroll at ~10 pkt/s; status = Run.
4. Toggle channels; change avg size `k` → coarser/finer trace; change window `N`
   → more/less history.
5. Scroll over plot → vertical/horizontal zoom; settings scale overrides.
6. Start/Pause halts ingestion; Clear empties buffers; Connect to real Power
   Pico @115200 shows live data.
7. **Session measurements**: V/I/W live values sane; energy (J/Wh) and charge
   (C/mAh) accumulate continuously; reset button zeroes them without stopping.
8. **Drag region**: click-drag on chart → shaded band appears → region panel
   shows Δt, energy, charge over that interval. Esc clears. New drag replaces.
9. **T+0 reset**: "Set T=0" button → x-axis relabels to elapsed from that point.
   Disconnect/reconnect device → auto-adjust (jump detected). Manual "Reset
   T=0" available.
10. **Feature detection**: open in a browser without Web Serial → banner shown,
    no crash. Simulate mode still works.

## Decisions
- Main-thread engine (no worker) — confirmed.
- uPlot for rendering — confirmed (user suggested).
- Drawing app = template only; scope is sole purpose → repurpose shell; drawing
  code **fully removed** (confirmed).
- Read-only serial; baud configurable (default 115200).
- x-axis = device timestamp (us) = true time-base; averaging by `k` packets sets
  effective min timestep (oscilloscope-like).
- **Feature-detect** Web Serial (`'serial' in navigator`), no vendor checks.
- **T+0 reset**: configurable offset + auto discontinuity detection (jump > 1s backward).
- **Two energy/charge integrators**: session (continuous, resettable w/o stop)
  + drag-region (on-chart selection).

## Further Considerations
1. Web Serial: **feature-detect** `'serial' in navigator`. Firefox 151+, Chrome
   89+, Edge 89+ all support it. Show a banner if missing — browser-agnostic,
   no hardcoded vendor checks.
2. Defaults: avg `k=10`, window `N=1000` (both configurable).
3. **T+0 reset**: configurable offset subtracted from raw device timestamps.
   Auto-detects timestamp jumps backward > 1s (device reboot, firmware reset)
   and adjusts `tZeroOffsetUs` to keep the trace continuous. Overflow is
   theoretical (uint64 μs = ~585k years), but the discontinuity guard handles
   real-world resets. User can also manually "Set T=0" at any time.
4. **Two energy/charge tiers**:
   - Session: accumulates from all samples since last reset. Persists across
     start/pause cycles. Reset button.
   - Region: click-drag on the uPlot chart to select a time window. Compute
     energy (J) and charge (C) over that interval. Visual overlay (shaded band).
     Esc to clear.
