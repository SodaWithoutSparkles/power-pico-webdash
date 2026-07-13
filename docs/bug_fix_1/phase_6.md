# Phase 6: Visual Window Band + W-off-by-default

Implements Step 6 from `pending-issues.md` (§7a Visual window band, §7b W-off-by-default).

## Summary

### Visual window band
Render-only feature. Each visible channel's data is divided into 200 time buckets across the visible X range. Per bucket: min/max/avg computed. Rendered as:
- Semi-transparent band (12% opacity fill + 25% opacity border) between min and max.
- Bright avg line (full opacity, 1.5px width) on top.

Replaces default uPlot line rendering (series set to `show: false` in buildSeries). Data pipeline unchanged — raw samples preserved.

### W-off-by-default
Power (W) channel disabled by default. User can enable in settings. Voltage and current remain enabled.

## Files Changed

### 1. `src/scope/ScopeEngine.ts`
- `DEFAULT_CONFIG.channels`: `w` changed from `true` to `false`.

### 2. `src/scope/useScopeEngine.ts`
- `buildSeries()`: each channel series now has `show: false` (data loaded, not drawn by uPlot).
- `tooltipPlugin()`: removed `series.show === false` guard — tooltips now show for all series.
- `wheelZoomPlugin` double-click: removed `show === false` guard from Y auto-range.
- Added `visualBandPlugin()`: 200-bucket min/max/avg band renderer in `draw` hook.
- Plugins order: `wheelZoom → tooltip → visualBand → detectorMarkers`.

## Design Decisions

- **Ponytail**: bucket count fixed at 200 (not configurable). Good balance of visual smoothness and performance.
- **Opacity levels**: band at 12%, border at 25%, avg line at 100%. Band is visible but doesn't obscure.
- **Fallback**: when a bucket has 0 points (gap in data), that bucket is skipped (no line/band segment). This creates natural gaps matching data gaps.
- **Scale**: each channel uses its own uPlot scale (`yV`/`yI`/`yW`) for Y-positioning, matching the per-series axes from Phase 2.

## Acceptance Criteria

1. `tsc --noEmit` clean.
2. 23/23 tests pass.
3. Graph shows visual band (min/max fill + avg line) for each channel.
4. W channel off by default (not visible until enabled in settings).
5. Region selection, tooltip, zoom, preview, scrollbar, detector markers all still work.

## Implementation Status

- **Build**: `tsc --noEmit` clean, `vite build` passes
- **Tests**: 23/23 pass
