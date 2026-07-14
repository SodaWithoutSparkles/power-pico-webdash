# Detailed Implementation Plan — Power Pico WebDash

Based on `new-plan.md` architecture (Web Worker + Canvas 2D), mapped against
current codebase state. All phases are concrete, ordered by dependency.

---

## Current State (Before Starting)

### Already Done (Reusable)

| What | Files | Notes |
|------|-------|-------|
| Protocol decode | `src/scope/decode.ts`, `decode.test.ts` | PacketParser, scaling math, header alignment. Keep as-is. |
| Web Serial types | `src/types/web-serial.d.ts` | Ambient declarations for navigator.serial. Keep. |
| uPlot dep | `package.json` has `"uplot"` | Will be removed in cleanup (switching to Canvas 2D). No-op for now. |
| Tailwind + Vite + React setup | `package.json`, `vite.config.ts`, `index.html` | Keep all. |
| Notifications | `src/components/common/NotificationCenter.tsx`, `src/store/slices/notificationsSlice.ts` | Keep — reused for scope errors/toasts. |
| ErrorBoundary | `src/ErrorBoundary.tsx` | Keep. |
| Layout shell files | `src/components/layout/MainLayout.tsx`, `Header.tsx`, `LeftSidebar.tsx`, `RightSidebar.tsx`, `BottomBar.tsx` | **Will be repurposed**, not deleted. Each component's internals swap from drawing to scope. |
| Header menu components | `header/FileMenu.tsx`, `EditMenu.tsx`, `OptionsMenu.tsx`, `HelpMenu.tsx`, `MenuItem.tsx` | **Will be repurposed** — menu structure stays, actions change. |
| Zustand | `package.json` has `"zustand"` | Keep — used for new scope store. |

### To Be Replaced / Removed (Phase E)

| What | Files |
|------|-------|
| Drawing engine | `src/components/canvas/` entire tree (DrawingCanvas, ShapeRenderer, etc.) |
| Drawing store | `src/store/useStore.ts`, `storeTypes.ts`, `storeDefaults.ts`, `storage.ts`, `slices/canvasSlice.ts`, `toolsSlice.ts`, `colorsSlice.ts`, `navigationSlice.ts`, `projectSlice.ts`, `preferencesSlice.ts` |
| Old types | `src/types.ts` (CanvasItem, shape types, SaveFile) |
| Drawing utils | `src/utils/compress.ts`, `projectName.ts`, `saveProject.ts` |
| Drawing components | `DualColorPicker`, `ColorPicker`, `PopoverSlider`, `ToolSettingsModal`, `ShortcutConfigModal`, `HelpModal`, `KeyboardShortcuts` |
| Unused deps | `konva`, `react-konva`, `tailwind-merge` (keep `clsx`) |
| Old engine | `src/scope/ScopeEngine.ts`, `DisplayRingBuffer.ts`, `AveragingBuffer.ts` (replaced by worker + new ring buffer) |

---

## Phase A — Worker Engine Infrastructure

**Goal:** Build the Web Worker that owns serial ingest, the SoA ring buffer,
the format engine (min-max bucketing), and the postMessage API. Also build the
hysteresis scale logic as a pure function (used later in Phase C).

**Depends on:** `decode.ts` (done), `web-serial.d.ts` (done)

### A.1 — Worker Types & Message Protocol

File: `src/scope/workerTypes.ts`

- `TelemetryRingBuffer` class: SoA with `BigInt64Array` (timestamps),
  `Float32Array` (voltages), `Float32Array` (currents). Capacity configurable
  (default 1_000_000). Push, binary search by timestamp, snapshot helpers.
- `BucketedTelemetryData` — avg/min/max for V and I as `Float32Array`, plus
  `BigInt64Array` timestamps. The return type for all bucketing queries.
- `WorkerRequest` discriminated union:
  - `{ type: "init", config: { baudRate, capacity } }`
  - `{ type: "start" }` / `{ type: "pause" }` / `{ type: "clear" }`
  - `{ type: "connect-serial" }` / `{ type: "disconnect" }`
  - `{ type: "start-simulate" }` / `{ type: "stop-simulate" }`
  - `{ type: "get-data-since", sinceTs: bigint, bucketCount: number }`
  - `{ type: "get-data-window", fromFraction: number, toFraction: number, bucketCount: number }`
  - `{ type: "get-frac-by-ts", targetTs: bigint }`
  - `{ type: "set-t-zero", rawTsUs: number }` / `{ type: "reset-t-zero" }`
  - `{ type: "get-integration", startTs: bigint, endTs: bigint }`
- `WorkerResponse` discriminated union:
  - `{ type: "status", payload: { running, mode, pktPerSec, sampleCount, bufferFillPct, liveV, liveI, liveW, lastTimestampUs } }`
  - `{ type: "bucketed-data", payload: BucketedTelemetryData }` **+ transferables**
  - `{ type: "window-data", payload: BucketedTelemetryData }` **+ transferables**
  - `{ type: "frac", payload: number }`
  - `{ type: "integration-result", payload: { energyJ, chargeC, dtUs } }`
  - `{ type: "error", message: string }`

### A.2 — TelemetryRingBuffer

File: `src/scope/TelemetryRingBuffer.ts`

- Constructor takes `capacity: number` (default 1_000_000).
- SoA storage: `timestamps: BigInt64Array`, `voltages: Float32Array`,
  `currents: Float32Array`.
- `head` write index, `count` (wraps to capacity when full).
- `push(ts: bigint, v: number, i: number): void`
- `length`, `fillPct` getters.
- `binarySearch(ts: bigint): number` — returns index of first element >= ts
  (classic binary search on the ring's chronological segment). Handles wrap.
- `slice(startIdx, endIdx): { timestamps, voltages, currents }` — returns
  contiguous typed arrays (may need two-part copy if wrapped).
- `clear(): void`

Key detail: timestamps are stored as `BigInt64Array` because the protocol uses
µs timestamps and >2^53 µs (~285k years) is theoretical; but since the plan
specifies `BigInt64Array`, we use it. For display math, convert to `number`
(µs since T+0 fits in float64 for any practical session).

### A.3 — Format Engine (Min-Max Bucketing)

File: `src/scope/FormatEngine.ts`

- `bucketData(ring: TelemetryRingBuffer, startTs: bigint, endTs: bigint, bucketCount: number): BucketedTelemetryData`
  1. Binary-search `startTs` and `endTs` to get ring indices.
  2. Divide index range into `bucketCount` equal slices.
  3. For each slice: compute `minV`, `maxV`, `avgV`, `minI`, `maxI`, `avgI`,
     and the midpoint timestamp.
  4. Return `BucketedTelemetryData` with `Float64Array`s (timestamps as number)
     and `Float32Array`s (min/avg/max for V and I).
- `bucketDataSince(ring: TelemetryRingBuffer, sinceTs: bigint, bucketCount: number): BucketedTelemetryData`
  — same algorithm but from `sinceTs` to head. Used for live scrolling.

### A.4 — Web Worker Entry

File: `src/scope/scope.worker.ts`

```
onmessage = (e: MessageEvent<WorkerRequest>) => {
  switch (e.data.type) {
    case "init":           create ring buffer + parser; break;
    case "start":          start serial read loop or simulator; break;
    case "pause":          stop sources; break;
    case "clear":          reset parser + ring + integrators; break;
    case "connect-serial": requestPort/open; break;
    case "disconnect":     close port; break;
    case "start-simulate": start Simulator interval; break;
    case "get-data-since": bucketSince + postMessage(transfer); break;
    case "get-data-window": bucketWindow + postMessage(transfer); break;
    case "get-frac-by-ts": binarySearch + postMessage; break;
    case "set-t-zero":     update offset; break;
    case "reset-t-zero":   reset offset; break;
    case "get-integration": binarySearch slice + integrate + postMessage; break;
  }
}
```

- Owns: `PacketParser`, `TelemetryRingBuffer`, `Simulator`, T+0 offset,
  discontinuity guard (same logic as current `ScopeEngine.ingest`).
- Emit status via `postMessage({ type: "status", payload })` on a throttle
  (every ~250ms or on status change).
- All bucketed data returned as transferable `ArrayBuffer`s:
  `postMessage(resp, [buf1, buf2, ...])`.

### A.5 — Simulator (Worker-Compatible)

File: `src/scope/simulate.ts` (extend existing)

- Keep existing `Simulator` class. It's already pure/DOM-free, so it runs
  inside the worker as-is. The worker calls `sim.next()` on a `setInterval`.

### A.6 — Hysteresis Scale (Pure Function)

File: `src/scope/hysteresis.ts`

- `type ScaleTier = "ua" | "ma" | "a"`
- `interface HysteresisState { tier: ScaleTier; downTimer: number }`
- `updateScale(state: HysteresisState, peakCurrentA: number, now: number): HysteresisState`
  — Schmitt trigger logic per new-plan §5 table:
  - If peak > 1.0 A → instant up to "a", reset timer.
  - If peak > 500e-6 A → instant up to "ma", reset timer.
  - If peak < 400e-6 A and tier is "ma" → start/accumulate timer; if
    timer >= 1500ms → down to "ua", reset timer.
  - If peak < 0.8 A and tier is "a" → start/accumulate timer; if
    timer >= 1500ms → down to "ma", reset timer.
  - Otherwise: reset timer (signal is still in band).
- `peakToUnitValue(peak: number, tier: ScaleTier): number` — converts amps
  to display value (e.g., 0.5 µA → 500).
- `tierToLabel(tier: ScaleTier): string` — returns "µA", "mA", "A".

Pure, no UI deps. Used by Phase C canvas renderer.

### A.7 — Integration Math

File: `src/scope/integrator.ts`

- `class DualStageIntegrator`:
  - `microQ: number` (Coulombs), `microE: number` (Joules) — fractional accumulators.
  - `totalQ: number`, `totalE: number` — integer-flushed global totals.
  - `lastTs: bigint | null` — previous timestamp for Δt computation.
  - `push(ts: bigint, v: number, i: number): void`:
    - If `lastTs` is null, store ts and return.
    - Δt = (ts - lastTs) / 1e9 (seconds).
    - dQ = i × Δt; dE = v × i × Δt.
    - Add to micro accumulators.
    - If microQ >= 1.0: totalQ += floor(microQ); microQ -= floor(microQ).
    - Same for microE.
    - Update lastTs.
  - `reset(): void` — zero all accumulators.
  - `getTotals(): { chargeC: number, energyJ: number }` — sum micro + total.

- `function integrateRange(ring: TelemetryRingBuffer, startTs: bigint, endTs: bigint): { energyJ: number, chargeC: number, dtUs: number }`
  — binary search indices, tight loop over raw slice, no dual-stage (single
  pass for selection). Returns J and C over that window.

### A.8 — Worker Status Types

File: `src/scope/engineTypes.ts` (update)

- Keep `ScopeConfig`, `ScopeChannels`, `ScopeMode`, `ScopeStatus`.
- Remove `DisplayPoint`, `DisplaySnapshot` (replaced by bucketed data).
- Add `ScaleTier`, `HysteresisState`, `BucketedTelemetryData`.
- Remove `StatusCallback`/`ErrorCallback` (replaced by postMessage protocol).

---

## Phase B — Verification Scaffold

**Goal:** Prove the worker engine works end-to-end with minimal UI. No fancy
graph — just text readouts and buttons.

**Depends on:** Phase A

### B.1 — Scope Store (Zustand)

File: `src/store/scopeStore.ts`

```
interface ScopeStore {
  // Config
  config: ScopeConfig;
  setConfig: (patch: Partial<ScopeConfig>) => void;

  // Status (updated by worker messages)
  status: ScopeStatus;
  setStatus: (s: ScopeStatus) => void;

  // Engine lifecycle
  start: () => void;
  pause: () => void;
  clear: () => void;
  startSimulate: () => void;
  connectSerial: () => void;
  disconnect: () => void;

  // Bucketed data (latest from get-data-since)
  latestData: BucketedTelemetryData | null;
  setLatestData: (d: BucketedTelemetryData | null) => void;

  // T+0
  setTZero: () => void;
  resetTZero: () => void;

  // Worker ref (set once on mount)
  workerRef: Worker | null;
  setWorkerRef: (w: Worker | null) => void;
}
```

**Important:** Keep this store separate from the old drawing store. Both can
coexist during transition. The old store is deleted in Phase E.

### B.2 — ScopeEngineManager (Worker Lifecycle Hook)

File: `src/scope/useScopeEngineManager.ts`

- React hook that:
  - On mount: creates `new Worker(new URL("./scope.worker.ts", import.meta.url), { type: "module" })`.
  - Sends `{ type: "init", config }`.
  - Listens for `message` events → dispatches to store (`setStatus`, `setLatestData`).
  - Exposes `start()`, `pause()`, `clear()`, `startSimulate()`, `connectSerial()`, `disconnect()`.
  - On unmount: `worker.terminate()`.

### B.3 — ScopeDebugPanel (Minimal Verification UI)

File: `src/scope/ScopeDebugPanel.tsx`

- A simple panel component that shows **no graph**, just text readouts:
  - **Status badge**: 🟢 Running / 🔴 Paused / 🟡 Simulating
  - **Ring buffer**: "{{fillPct * 100 | round}}% full ({{sampleCount}} samples)"
  - **Live values**: "V: {{liveV.toFixed(3)}} V  |  I: {{liveA.toFixed(6)}} A  |  P: {{liveW.toFixed(3)}} W"
  - **Packet rate**: "{{pktPerSec}} pkt/s"
  - **Last timestamp**: "{{lastTimestampUs}} µs"
- Buttons:
  - **Simulate** (starts simulated data)
  - **Start / Pause** (toggles)
  - **Clear** (resets buffers)
  - **Connect Serial** (if Web Serial available)
  - **Disconnect** (if connected)
- Simple layout: centered card on dark background. Uses `clsx` + Tailwind.
- This is temporary; will be replaced by ScopeCanvas + real UI in Phase C.

### B.4 — Wire Into MainLayout

File: `src/components/layout/MainLayout.tsx` (edit)

- Replace `<DrawingCanvas />` with `<ScopeDebugPanel />`.
- The header, sidebar, right panel, and bottom bar still show drawing content.
  That's fine for now — Phase C repurposes them.
- `<NotificationCenter />` stays.

### B.5 — Vite Worker Config

File: `vite.config.ts` (check)

- Vite supports Web Workers out of the box with `new Worker(new URL(...), { type: "module" })`.
  No plugin needed. Verify the config doesn't block worker bundles.

### B.6 — Smoke Test

- `npm run dev` → open browser.
- Click **Simulate** → status shows Running, sample count climbs, live V/I/W
  update every ~250ms.
- Click **Pause** → stops.
- Click **Clear** → counters reset.
- If serial device connected: **Connect Serial** → real data flows.
- Open browser devtools → verify no errors, Transferables are flowing.

---

## Phase C — UI Redesign + Canvas Graph

**Goal:** Replace the drawing UI with the full scope interface. Keep header
bar, sidebars, and status bar as layout shells but swap internal content.

**Depends on:** Phase A (worker API), Phase B (worker hook, store)

### C.1 — Repurpose Header

File: `src/components/layout/Header.tsx`

- Keep the dropdown menu bar structure and all 4 menus (File, Edit, Options, Help).
- **File menu** replaces drawing save/open with:
  - "Connect Serial" / "Disconnect" (toggle)
  - "Start Simulate"
  - "Start" / "Pause" (toggle)
  - "Clear"
  - "Set T=0"
  - Separator
  - "Export Screenshot..."
- **Edit menu** replaces undo/redo/clone with:
  - "Copy Graph" (copy to clipboard as image)
  - "Reset View"
- **Options menu** keeps "Keyboard Shortcuts..." (repurpose later) + "About"
- **Help menu** stays same structure
- Remove references to old store (`useStore`). Wire to `scopeStore` instead.

### C.2 — Repurpose Left Sidebar (Channel Toolbar)

File: `src/components/layout/LeftSidebar.tsx`

- Replace drawing tool buttons with scope channel toggles:
  - **V** (Voltage) — toggle, color indicator
  - **I** (Current) — toggle, color indicator
  - **W** (Power) — toggle, color indicator
- Add: **Scale mode** toggle (Auto / Manual)
- Add: **Cursor mode** toggle (Crosshair / Drag-select)
- Add separator line
- Keep the same narrow (w-12) vertical layout, same dark styling.
- Icons from `lucide-react`: `Zap` (V), `Activity` (I), `Gauge` (W).

### C.3 — Repurpose Right Sidebar (Settings Panel)

File: `src/components/layout/RightSidebar.tsx`

- Replace object settings + history with collapsible scope settings:
  - **Connection**: baud rate input, connect/disconnect button
  - **Buffers**: averaging size (k), display window size (N)
  - **Channels**: checkboxes for V/I/W with color swatches
  - **Vertical Scale**: Auto / Manual min-max inputs
  - **Horizontal Zoom**: slider or input
  - **T+0**: button to set current time as T=0, button to reset
- Section headers collapse/expand (start with Connection expanded).
- Replace drawing's `ColorPicker`, `Sliders` with `Input`, `Select`, `Toggle`.

### C.4 — Repurpose Bottom Bar (Scope Status Bar)

File: `src/components/layout/BottomBar.tsx`

- Replace tool tips + auto-save status with scope annunciators:
  - **Status LED**: 🟢 Run / 🔴 Paused (green/red dot)
  - **Mode**: Serial / Simulate badge
  - **pkt/s**: live packet rate
  - **Samples**: total sample count
  - **Buffer**: fill % with micro progress bar
  - **Live V/I/W**: compact readouts (e.g. "V 5.012 | I 0.502 A | P 2.516 W")
- Keep the same bar layout and dark styling.

### C.5 — ScopeCanvas (Graph Rendering Engine)

File: `src/scope/ScopeCanvas.tsx`

- Canvas 2D component, full-width center area.
- `requestAnimationFrame` render loop:
  1. Fetch latest `BucketedTelemetryData` from store (or worker callback).
  2. Run hysteresis scale update (from `hysteresis.ts`) on current peak values.
  3. Clear canvas, draw grid lines.
  4. For each enabled channel:
     - Draw transparent fill between min and max arrays (envelope band).
     - Draw solid line for average array.
  5. Draw X/Y axis labels with current scale unit (µA/mA/A from hysteresis).
  6. If drag-selection active: draw shaded region overlay.
- Props: none (reads from `scopeStore` via hook).
- Handles resize via `ResizeObserver`.
- Mouse interactions: mousedown starts drag-select, mouseup sends region
  timestamps to worker for integration, Esc clears selection.
- Zoom: wheel handler adjusts horizontal zoom level.

### C.6 — Measurements Panel

File: `src/scope/Measurements.tsx`

- Two-tier readout rendered inside the right sidebar (or as a separate
  collapsible section):
  - **Live**: instant V, I, W from latest averaged point.
  - **Session**: total energy (J / Wh), total charge (C / mAh).
    Read from worker via `get-integration` or pushed via status updates.
  - **Region**: when drag-selection active, shows Δt, energy, charge over
    selection. Clears on Esc.
- Simple `<div>` layout, monospaced numbers, Tailwind styling.

### C.7 — Wire MainLayout for Scope

File: `src/components/layout/MainLayout.tsx` (final form)

```
<div class="flex flex-col h-screen bg-gray-900">
  <Header />
  <div class="flex-1 flex overflow-hidden">
    <LeftSidebar />
    <div class="flex-1 relative">
      <ScopeCanvas />
    </div>
    <RightSidebar />
  </div>
  <BottomBar />
  <NotificationCenter />
</div>
```

No more `DrawingCanvas`, `KeyboardShortcuts`, `Suspense` for canvas.

---

## Phase D — Integration Math & Selection

**Goal:** Wire the worker-side integration math to the UI drag-select feature.

**Depends on:** Phase C (needs ScopeCanvas with drag-select)

### D.1 — Worker Selection Integration

- Already built in A.7 (`integrateRange`). Wire to `get-integration` message.
- Worker runs binary search + tight loop over raw ring buffer slice.
- Returns `{ energyJ, chargeC, dtUs }` via postMessage.

### D.2 — UI Selection Overlay

- `ScopeCanvas` mousedown/mouseup tracks start/end timestamps.
- Sends `{ type: "get-integration", startTs, endTs }` to worker.
- On response, stores result in `scopeStore.selection`.
- `Measurements` component reads `scopeStore.selection` and displays.

### D.3 — Session Accumulator Display

- Worker's `DualStageIntegrator` accumulates continuously.
- Worker includes running totals in periodic status messages, or main thread
  requests `get-integration` on a timer (e.g., every 1s).
- Displayed in the right sidebar or bottom bar.

---

## Phase E — Cleanup

**Goal:** Remove all dead drawing code. Final pruning.

**Depends on:** Phase C (new UI must be fully in place first)

### E.1 — Remove Drawing Components

Delete these directories and files:

- `src/components/canvas/` (entire tree)
- `src/components/common/DualColorPicker.tsx`
- `src/components/common/ColorPicker.tsx`
- `src/components/common/PopoverSlider.tsx`
- `src/components/common/ToolSettingsModal.tsx`
- `src/components/common/ShortcutConfigModal.tsx`
- `src/components/help/HelpModal.tsx`
- `src/components/layout/header/FileMenu.tsx` (replaced by scope version)
- `src/components/layout/header/EditMenu.tsx` (replaced)
- `src/components/layout/header/OptionsMenu.tsx` (replaced)
- `src/components/layout/header/HelpMenu.tsx` (replaced)
- `src/components/layout/header/MenuItem.tsx` (replaced)

### E.2 — Remove Drawing Store & Utils

- `src/store/useStore.ts`
- `src/store/storeTypes.ts`
- `src/store/storeDefaults.ts`
- `src/store/storage.ts`
- `src/store/slices/` — keep only `notificationsSlice.ts` (still used).
  Delete: `canvasSlice.ts`, `toolsSlice.ts`, `colorsSlice.ts`,
  `navigationSlice.ts`, `projectSlice.ts`, `preferencesSlice.ts`.
- `src/types.ts`
- `src/utils/compress.ts`
- `src/utils/projectName.ts`
- `src/utils/saveProject.ts`

### E.3 — Remove Old Engine Files

- `src/scope/ScopeEngine.ts`
- `src/scope/DisplayRingBuffer.ts`
- `src/scope/AveragingBuffer.ts`

(Keep `decode.ts`, `decode.test.ts`, `simulate.ts`, `ScopeEngine.test.ts`
— the test file can be deleted later since the engine it tests is gone.)

### E.4 — Remove Unused Dependencies

```bash
npm uninstall konva react-konva tailwind-merge
```

Keep `clsx` (useful for UI), `lucide-react` (scope icons),
`zustand` (scope store), `uplot` (remove if not needed — Canvas 2D replaces it).

### E.5 — Simplify App.tsx

```
function App() {
  return (
    <>
      <NotificationCenter />
      <MainLayout />
    </>
  );
}
```

No changes needed — it's already simple. Just verify no drawing imports remain.

### E.6 — Final Verification

```bash
npm run dev    # opens scope UI
npm run build  # production build succeeds with no drawing imports
```

---

## File Inventory — New & Changed

### New Files (Phase A)

| File | Purpose |
|------|---------|
| `src/scope/workerTypes.ts` | Message protocol types, BucketedTelemetryData, request/response unions |
| `src/scope/TelemetryRingBuffer.ts` | SoA ring buffer (BigInt64Array + Float32Array×2) |
| `src/scope/FormatEngine.ts` | Min-Max bucketing algorithm |
| `src/scope/scope.worker.ts` | Web Worker entry (onmessage dispatcher) |
| `src/scope/hysteresis.ts` | Schmitt trigger scale switching (pure function) |
| `src/scope/integrator.ts` | DualStageIntegrator + integrateRange |

### New Files (Phase B)

| File | Purpose |
|------|---------|
| `src/store/scopeStore.ts` | Zustand store for scope state |
| `src/scope/useScopeEngineManager.ts` | Worker lifecycle hook |
| `src/scope/ScopeDebugPanel.tsx` | Minimal verification UI (text readouts) |

### New Files (Phase C)

| File | Purpose |
|------|---------|
| `src/scope/ScopeCanvas.tsx` | Canvas 2D graph rendering |
| `src/scope/Measurements.tsx` | Live/session/region readout panel |

### Changed Files

| File | Phase | Change |
|------|-------|--------|
| `src/scope/engineTypes.ts` | A.8 | Update types (remove DisplayPoint/Snapshot, add BucketedTelemetryData etc.) |
| `src/scope/simulate.ts` | A.5 | Already worker-compatible; minor refinement |
| `src/components/layout/MainLayout.tsx` | B.4, C.7 | Swap DrawingCanvas → ScopeDebugPanel → ScopeCanvas |
| `src/components/layout/Header.tsx` | C.1 | Repurpose menu actions for scope |
| `src/components/layout/LeftSidebar.tsx` | C.2 | Tools → channel toggles |
| `src/components/layout/RightSidebar.tsx` | C.3 | Object settings → scope config |
| `src/components/layout/BottomBar.tsx` | C.4 | Drawing status → scope status |
| `vite.config.ts` | B.5 | Verify worker support |

### Deleted Files (Phase E)

See E.1–E.4 above (~30 files).

---

## Dependency Graph

```
Phase A (Worker Engine)
  │
  ▼
Phase B (Verification Scaffold) ─── depends on A
  │
  ▼
Phase C (UI Redesign + Canvas Graph) ─── depends on A (worker), B (hook/store)
  │
  ▼
Phase D (Integration Math) ─── depends on A (integrator), C (drag-select)
  │
  ▼
Phase E (Cleanup) ─── depends on C (new UI in place)
```

Phases A and B can be tested without any hardware (simulate mode).
Phase C delivers the full visual experience.
Phase D adds the analytical features.
Phase E is pure deletion — no functional changes.

---

## Success Criteria Per Phase

| Phase | Criteria |
|-------|----------|
| **A** | `node --test --experimental-strip-types` passes. Worker boots, Simulator mode streams data through ring buffer, `get-data-since` returns bucketed arrays via Transferables. |
| **B** | Click Simulate → text readouts update live. Start/Pause/Clear work. No console errors. |
| **C** | Canvas renders V/I/W traces at 60 FPS. Hysteresis switches µA/mA/A smoothly. Header/sidebars/status bar show scope content. |
| **D** | Drag region on canvas → energy/charge readout appears. Session accumulators climb continuously. Reset clears them. |
| **E** | `npm run build` succeeds. No drawing code remains. App is pure scope monitor. |
