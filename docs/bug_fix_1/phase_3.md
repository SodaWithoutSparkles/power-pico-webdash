# Phase 3: Zoom & Scroll UX

Implements Step 3 from `pending-issues.md` (§5 Zoom & scroll UX).

## Summary

### Wheel zoom
- **Running**: zooms centered on newest data point (not cursor).
- **Paused**: zooms centered on cursor.
- **Shift modifier**: zooms X 2.3× faster (factor 0.7 vs 0.9). Old Shift+pan removed.
- **Y zoom**: left gutter→yV, right gutter→yI+yW (unchanged from Phase 2).

### X clamp
Visible X range cannot exceed `bufferSec × 1e6` us. Enforced in wheel handler and rAF auto-range loop. Prevents zooming out past buffer duration.

### ZoomedPreview (new component)
Mini-map canvas overlay (200×80) in bottom-right corner. Shows when zoomed in:
- Grid lines, channel-colored traces (V/I/W) for full buffer.
- Per-channel Y normalization (10% margin).
- Green view-window rectangle overlay.
- **Click**: jump view window centered on click.
- **Double-click**: reset X to full buffer, Y scales to data bounds.
- Hidden at full buffer (5% tolerance) or empty data.

### Scrollbar (new component)
Div-based horizontal bar (12px) at chart bottom:
- Visible only when **paused AND zoomed in** (5% tolerance).
- Green draggable thumb shows view window position/size.
- **Drag thumb**: scroll chart live.
- **Click track**: jump view centered there.
- Hidden while running or fully zoomed out.

### uPlot ref lifted
`uRef` moved from local in `useScopeEngine` to `ScopeView` parent. Shared to `ZoomedPreview` and `Scrollbar` as props.

## Files Changed

### 1. `src/scope/useScopeEngine.ts`
- **Signature**: `useScopeEngine(containerRef, uRef, channelKey)` — receives uRef from parent instead of creating locally.
- **wheelZoomPlugin**: zoom anchor depends on running state. Shift=fast zoom (0.7) instead of pan. X clamp enforces `bufferSec` max range.
- **rAF loop**: `effectiveHz` clamped to `bufferSec`. Post-auto-range clamp shrinks visible window if it exceeds max.
- Removed shift+pan X code entirely.

### 2. `src/scope/ScopeView.tsx`
- Added `import uPlot from "uplot"` and `const uRef = useRef<uPlot | null>(null)`.
- Passes `uRef` as 2nd arg to `useScopeEngine`.
- Renders `<ZoomedPreview uRef={uRef} />` and `<Scrollbar uRef={uRef} />`.

### 3. `src/scope/ZoomedPreview.tsx` (new)
- Canvas-based minimap. rAF-driven render loop.
- Reads engine snapshot for full-buffer data.
- Draws per-channel traces with Y normalization.
- Click-to-jump, double-click-to-reset.

### 4. `src/scope/Scrollbar.tsx` (new)
- Div-based horizontal scrollbar.
- rAF-driven position sync from uPlot scales.
- Drag thumb to scroll, click track to jump.
- Visibility gated on `!running && zoomed`.

## Design Decisions

- **Ponytail**: click-to-jump instead of drag on preview (drag adds complexity for minimal gain).
- **Ponytail**: single interaction flag (`lastXZoomMs`) for all X zoom. Shift+wheel resets the same 2s auto-follow timer.
- **Preview Y normalization**: each channel uses its own min/max for vertical scaling. Traces from different channels may overlap — this is acceptable for a minimap.
- **Scrollbar approach**: div-based (not canvas) — simpler, CSS handles layout.
- **5% tolerance**: prevents false "zoomed in" flicker when data and view window are nearly identical (rounding).

## Acceptance Criteria

1. `tsc --noEmit` passes clean.
2. `vite build` succeeds.
3. 23/23 tests pass.
4. Wheel zoom centers on newest data when running, cursor when paused.
5. Shift+wheel zooms faster (no pan).
6. Cannot zoom out beyond bufferSec.
7. Preview appears bottom-right when zoomed in.
8. Click preview → chart jumps to that position.
9. Scrollbar appears when paused + zoomed in.
10. Drag scrollbar thumb → chart scrolls.

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass
