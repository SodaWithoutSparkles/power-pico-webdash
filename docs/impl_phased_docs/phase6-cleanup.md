# Phase 6 Handoff — Cleanup (delete dead drawing code)

Status: **DONE**. `tsc --noEmit` clean. `vite build` succeeds (1715 modules).
Engine tests untouched (20/20 green from Phase 2/3).

## What shipped

Phase 6 removes the drawing-app template that was only used as a shell. The
scope UI (Phases 4–5) is now the entire app. No drawing code remains mounted;
the dead files were deleted. `KeyboardShortcuts` was **kept** (user request:
needed later) and repurposed to read `useScopeStore`.

### Deleted (drawing-only)
- `src/components/canvas/` — entire tree (`DrawingCanvas`, `ShapeRenderer`,
  `TextEditorOverlay`, all `hooks/`, `utils/`).
- `src/components/help/HelpModal.tsx`.
- `src/components/layout/header/` — `FileMenu`, `EditMenu`, `OptionsMenu`,
  `HelpMenu`, `MenuItem`.
- `src/components/layout/LeftSidebar.tsx`, `RightSidebar.tsx`, `BottomBar.tsx`,
  `Header.tsx` (drawing header).
- `src/components/common/DualColorPicker.tsx`, `ColorPicker.tsx`,
  `PopoverSlider.tsx`, `ToolSettingsModal.tsx`, `ShortcutConfigModal.tsx`.
- `src/store/useStore.ts`, `storeTypes.ts`, `storeDefaults.ts`, `storage.ts`.
- `src/store/slices/` — `canvasSlice`, `toolsSlice`, `colorsSlice`,
  `navigationSlice`, `notificationsSlice`, `preferencesSlice`, `projectSlice`.
- `src/types.ts` (drawing `CanvasItem` / `SaveFile` types).
- `src/utils/compress.ts`, `projectName.ts`, `saveProject.ts`.

### Kept (scope + shared)
- `src/store/scopeStore.ts` — sole store; self-contained, no drawing coupling.
- `src/components/common/NotificationCenter.tsx` — reads `useScopeStore`.
- `src/components/common/KeyboardShortcuts.tsx` — **repurposed** (see below).
- `src/scope/*` — engine, render hook, all scope UI components.
- `src/App.tsx`, `src/main.tsx`, `src/ErrorBoundary.tsx`, `src/index.css`.
- Tailwind setup, `uplot`, `zustand`, `lucide-react`, `react`, `react-dom`.

### Edited
- `src/components/common/KeyboardShortcuts.tsx` — was importing the deleted
  drawing `useStore`. Rewired to `useScopeStore` with scope shortcuts:
  - `Esc` → `clearRegion()`
  - `Space` → `start()` / `pause()` (toggles on `running`)
  - `R` → `resetSessionIntegrators()`
  - `T` → `setTZero()`
  - Ignores key events while typing in inputs/textareas/contenteditable.
  - Now **mounted** in `src/App.tsx` (was never mounted before — dead).
- `src/App.tsx` — added `<KeyboardShortcuts />` next to `NotificationCenter`.
- `src/scope/useScopeEngine.ts` — **vScale now applies live** via `setScale`
  (no chart rebuild). New effect watches `config.vScale` and calls
  `u.setScale("y", …)`; keeps user zoom. Resolves the Phase 5 handoff flag.
- `package.json` — removed unused deps: `react-konva`, `konva`, `tailwind-merge`,
  `clsx` (all only referenced by deleted drawing files). `lucide-react` kept
  (used by scope UI).

## Decisions / notes
- **One store, one notifier, one shortcuts module.** Everything reads
  `useScopeStore`. No second notification system, no drawing store. (ponytail:
  delete, don't leave half-dead.)
- **vScale live via `setScale`** instead of rebuild — keeps zoom stable and
  matches the Phase 5 flag recommendation. The chart still rebuilds only on
  channel-set change (`channelKey` dep).
- **`KeyboardShortcuts` kept per user request** ("needed later"). Rather than
  delete + re-add later, it's wired to the scope store now so the build stays
  green and the shortcuts are immediately useful (Space/R/T/Esc).
- **Dep pruning**: `react-konva`/`konva` were the heaviest drawing-only deps;
  dropping them shrinks the bundle. `clsx`/`tailwind-merge` had zero scope
  usage. `lucide-react` stays (scope icons).

## Verification
```
npx tsc --noEmit          # clean
npx vite build            # 1715 modules, no errors
node --test --experimental-strip-types src/scope/ScopeEngine.test.ts src/scope/decode.test.ts
# 20/20 green
```
Manual (browser + Web Serial secure context):
- App loads straight into the scope (no drawing shell).
- Change vertical scale (auto ↔ manual min/max) in `ScopeSettings` → y-axis
  updates **immediately**, no rebuild, zoom preserved.
- `Space` starts/pauses; `R` resets session integrators; `T` sets T=0;
  `Esc` clears the drag-region band.
- Connect / Simulate / Start / Pause / Clear / Set T=0 all functional.

## Next (Phase 7 — Polish, user input required)
- Test on real device @115200 baud; verify live traces + session integrators.
- Themes (dark/light), responsive layout, accessibility (ARIA, keyboard nav,
  contrast).
- Phase 8 (docs) + Phase 9 (i18n, deferred) remain per plan.
