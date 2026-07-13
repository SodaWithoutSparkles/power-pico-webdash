// Phase 4 — Scope render hook. Owns the uPlot instance lifecycle and the
// requestAnimationFrame loop that pulls engine snapshots into the chart.
// Decoupled from ingestion: the engine buffers, this loop only reads.
//
// Channel toggles change the series count, which uPlot fixes at construction,
// so the chart is rebuilt (effect re-runs) whenever `channelKey` changes.

import { useEffect, useRef, type RefObject } from "react";
import uPlot from "uplot";
import { useScopeStore } from "../store/scopeStore";
import type { RegionSelection } from "../store/scopeStore";
import type { ScopeConfig, YScale } from "./engineTypes";
import { createDebug, createDebugThrottled } from "../utils/debug";

const log = createDebug("render");
const logLoop = createDebugThrottled("render:loop", 500);

// Out-of-range notification tracking per channel (at most one active at a time).
const ooActive: Record<string, boolean> = { v: false, i: false, w: false };

const CHANNEL_COLORS = {
    v: "#22d3ee", // cyan
    i: "#f59e0b", // amber
    w: "#a78bfa", // violet
} as const;

const CHANNEL_LABELS = {
    v: "Voltage (V)",
    i: "Current (A)",
    w: "Power (W)",
} as const;

const GRID = "#374151";
const AXIS = "#9ca3af";
const REGION_FILL = "rgba(34,197,94,0.12)";
const REGION_STROKE = "rgba(34,197,94,0.6)";

// Build uPlot series from enabled channels. Index 0 is always the x (time) axis.
function buildSeries(channels: ScopeConfig["channels"]): uPlot.Series[] {
    const series: uPlot.Series[] = [{ label: "t (s)" }];
    if (channels.v)
        series.push({ label: CHANNEL_LABELS.v, scale: "yV", stroke: CHANNEL_COLORS.v, width: 2, points: { show: false }, show: false });
    if (channels.i)
        series.push({ label: CHANNEL_LABELS.i, scale: "yI", stroke: CHANNEL_COLORS.i, width: 2, points: { show: false }, show: false });
    if (channels.w)
        series.push({ label: CHANNEL_LABELS.w, scale: "yW", stroke: CHANNEL_COLORS.w, width: 2, points: { show: false }, show: false });
    return series;
}

// Build uPlot scales: one named Y scale per enabled channel.
function buildScales(channels: ScopeConfig["channels"]): uPlot.Scales {
    const scales: uPlot.Scales = { x: { time: false } };
    if (channels.v) scales.yV = { auto: true };
    if (channels.i) scales.yI = { auto: true };
    if (channels.w) scales.yW = { auto: true };
    return scales;
}

// Build uPlot axes: x at index 0, then one axis per enabled Y scale.
function buildAxes(channels: ScopeConfig["channels"]): uPlot.Axis[] {
    const axes: uPlot.Axis[] = [
        {
            values: xAxisValues,
            label: "Time (s)",
            stroke: AXIS,
            grid: { stroke: GRID },
            ticks: { stroke: GRID },
        },
    ];
    if (channels.v) {
        axes.push({
            scale: "yV",
            side: 1,
            label: CHANNEL_LABELS.v,
            stroke: CHANNEL_COLORS.v,
            grid: { stroke: GRID, show: false },
            ticks: { stroke: CHANNEL_COLORS.v },
        });
    }
    if (channels.i) {
        axes.push({
            scale: "yI",
            side: 3,
            label: CHANNEL_LABELS.i,
            stroke: CHANNEL_COLORS.i,
            grid: { stroke: GRID, show: false },
            ticks: { stroke: CHANNEL_COLORS.i },
        });
    }
    if (channels.w) {
        axes.push({
            scale: "yW",
            side: 3,
            label: CHANNEL_LABELS.w,
            stroke: CHANNEL_COLORS.w,
            grid: { stroke: GRID, show: false },
            ticks: { stroke: CHANNEL_COLORS.w },
        });
    }
    return axes;
}

// x values are display-time in microseconds; show elapsed seconds from T+0.
function xAxisValues(_u: uPlot, splits: number[]): string[] {
    return splits.map((s) => (s / 1_000_000).toFixed(2));
}

// Cursor tooltip plugin: a div that follows the cursor and shows the exact
// value of each visible series at the nearest sample. uPlot has no built-in
// tooltip, only a legend + cursor line, so we draw our own.
function tooltipPlugin(): uPlot.Plugin {
    let tooltip: HTMLDivElement;
    return {
        hooks: {
            ready: [
                (u: uPlot) => {
                    tooltip = document.createElement("div");
                    tooltip.className = "u-tooltip";
                    Object.assign(tooltip.style, {
                        position: "absolute",
                        pointerEvents: "none",
                        zIndex: "100",
                        display: "none",
                        background: "rgba(17,24,39,0.95)",
                        border: "1px solid #374151",
                        borderRadius: "4px",
                        padding: "6px 8px",
                        font: "12px/1.4 ui-monospace, monospace",
                        color: "#e5e7eb",
                        whiteSpace: "nowrap",
                    } as Partial<CSSStyleDeclaration>);
                    u.over.appendChild(tooltip);
                },
            ],
            setCursor: [
                (u: uPlot) => {
                    if (!tooltip) return;
                    const idx = u.cursor.idx;
                    if (idx == null) {
                        tooltip.style.display = "none";
                        return;
                    }
                    const tVal = u.data[0][idx];
                    let html = `<div style="color:#9ca3af">t = ${((tVal as number) / 1_000_000).toFixed(3)} s</div>`;
                    for (let s = 1; s < u.series.length; s++) {
                        const series = u.series[s];
                        const val = u.data[s][idx];
                        if (val == null) continue;
                        const color = String(series.stroke ?? "#fff");
                        html += `<div><span style="color:${color}">${series.label}</span>: ${(val as number).toFixed(3)}</div>`;
                    }
                    tooltip.innerHTML = html;
                    tooltip.style.display = "block";

                    const cL = u.cursor.left ?? 0;
                    const cT = u.cursor.top ?? 0;
                    const pad = 12;
                    const tb = tooltip.getBoundingClientRect();
                    const ob = u.over.getBoundingClientRect();
                    let left = cL + pad;
                    let top = cT + pad;
                    if (left + tb.width > ob.width) left = cL - pad - tb.width;
                    if (top + tb.height > ob.height) top = cT - pad - tb.height;
                    tooltip.style.transform = `translate(${left}px, ${top}px)`;
                },
            ],
        },
    };
}

// Wheel = zoom x (time axis) about the cursor (paused) or newest data (running).
// Shift+wheel = faster zoom (factor 0.7 instead of 0.9).
// Drag on the Y-axis gutter = pan yV (primary voltage axis only).
// uPlot has no built-in wheel zoom or axis-drag pan, so both are custom.
//
// X and Y interaction flags are kept separate so Y gutter drag never
// disables X auto-follow (the rAF loop uses each independently).
//
// Per-scale Y handling (ponytail: simple win):
//   - Left gutter (clientX < overRect.left): zoom/drag yV
//   - Right gutter (clientX > overRect.right): wheel-zoom yI and yW together
//   - Y gutter drag (mousedown): yV only
//   - Double-click: reset all Y scales independently using each series.scale
function wheelZoomPlugin(
    factor = 0.9,
    xPanRef?: { current: boolean },
    yAdjustedRef?: { current: boolean },
    lastXZoomMs?: { current: number },
    lastYZoomMs?: { current: number },
): uPlot.Plugin {
    let cleanup: (() => void) | null = null;
    return {
        hooks: {
            ready: [
                (u: uPlot) => {
                    let dragging = false;
                    let startClientY = 0;
                    let startOverTop = 0;
                    let startMin = 0;
                    let startMax = 0;

                    // Collect the right-side scale keys (yI, yW if they exist).
                    const rightScales: string[] = [];
                    if (u.scales.yI) rightScales.push("yI");
                    if (u.scales.yW) rightScales.push("yW");

                    const zoomScale = (scaleKey: string, overRect: DOMRect, e: WheelEvent) => {
                        const sy = (u.scales as Record<string, uPlot.Scale>)[scaleKey];
                        if (!sy || sy.min == null || sy.max == null) return;
                        const top = e.clientY - overRect.top;
                        const anchor = u.posToVal(top, scaleKey);
                        const oyRange = (sy.max as number) - (sy.min as number);
                        const nyRange = e.deltaY < 0 ? oyRange * factor : oyRange / factor;
                        const topPct = top / overRect.height;
                        const nyMin = anchor - topPct * nyRange;
                        const nyMax = nyMin + nyRange;
                        u.setScale(scaleKey, { min: nyMin, max: nyMax });
                    };

                    const onWheel = (e: WheelEvent) => {
                        e.preventDefault();
                        if (!u.over) return;

                        const overRect = u.over.getBoundingClientRect();

                        // Left Y-axis gutter → zoom yV about cursor.
                        if (e.clientX < overRect.left) {
                            zoomScale("yV", overRect, e);
                            if (lastYZoomMs) lastYZoomMs.current = Date.now();
                            return;
                        }

                        // Right Y-axis gutter → zoom right-side scales about cursor.
                        if (e.clientX > overRect.right) {
                            for (const sk of rightScales) zoomScale(sk, overRect, e);
                            if (lastYZoomMs) lastYZoomMs.current = Date.now();
                            return;
                        }

                        // X zoom on chart body.
                        const sx = u.scales.x;
                        if (sx.min == null || sx.max == null) return;

                        const running = useScopeStore.getState().running;
                        const bufferSec = useScopeStore.getState().config.bufferSec;
                        const maxXRange = bufferSec * 1_000_000;
                        const z = e.shiftKey ? 0.7 : 0.9; // shift = faster zoom

                        const oxRange = (sx.max as number) - (sx.min as number);
                        let nxRange = e.deltaY < 0 ? oxRange * z : oxRange / z;
                        nxRange = Math.min(nxRange, maxXRange); // X clamp

                        let nxMin: number, nxMax: number;

                        if (running) {
                            // Center on newest data when running
                            const snap = useScopeStore.getState().getEngine().snapshot();
                            const latest = snap.t.length > 0 ? snap.t[snap.t.length - 1] : (sx.max as number);
                            nxMax = latest;
                            nxMin = latest - nxRange;
                        } else {
                            // Center on cursor when paused
                            const left = e.clientX - overRect.left;
                            const leftPct = left / overRect.width;
                            const xVal = u.posToVal(left, "x");
                            nxMin = xVal - leftPct * nxRange;
                            nxMax = nxMin + nxRange;
                        }

                        u.setScale("x", { min: nxMin, max: nxMax });
                        if (lastXZoomMs) lastXZoomMs.current = Date.now();
                    };

                    // Drag on the left Y-axis gutter → pan yV only.
                    const onYMouseDown = (e: MouseEvent) => {
                        const overRect = u.over.getBoundingClientRect();
                        if (e.clientX >= overRect.left) return; // only the left Y-axis gutter
                        const sy = u.scales.yV;
                        if (!sy || sy.min == null || sy.max == null) return;
                        dragging = true;
                        startClientY = e.clientY;
                        startOverTop = overRect.top;
                        startMin = sy.min as number;
                        startMax = sy.max as number;
                        if (yAdjustedRef) yAdjustedRef.current = true;
                        e.preventDefault();
                    };
                    const onYMouseMove = (e: MouseEvent) => {
                        if (!dragging || !u.over) return;
                        const yStart = u.posToVal(startClientY - startOverTop, "yV");
                        const yNow = u.posToVal(e.clientY - startOverTop, "yV");
                        const delta = yStart - yNow; // keep the value under the cursor fixed
                        u.setScale("yV", { min: startMin + delta, max: startMax + delta });
                    };
                    const onYMouseUp = () => {
                        dragging = false;
                    };

                    // Double-click resets all axes to data-based bounds.
                    const onDblClick = () => {
                        // X bounds from data
                        const xData = u.data[0];
                        const xMin = xData.length > 0 ? xData[0] : 0;
                        const xMax = xData.length > 0 ? xData[xData.length - 1] : 1_000_000;
                        u.setScale("x", { min: xMin, max: xMax });

                        // Y bounds per scale, collected from each series' data.
                        const perScale: Record<string, { min: number; max: number }> = {};
                        for (let s = 1; s < u.series.length; s++) {
                            const scaleKey = u.series[s].scale;
                            if (!scaleKey || typeof scaleKey !== "string") continue;
                            const arr = u.data[s];
                            if (!arr) continue;
                            let lo = Infinity, hi = -Infinity;
                            for (let k = 0; k < arr.length; k++) {
                                const val = arr[k];
                                if (val == null) continue;
                                if (val < lo) lo = val;
                                if (val > hi) hi = val;
                            }
                            if (lo === Infinity) continue;
                            if (!perScale[scaleKey]) {
                                perScale[scaleKey] = { min: lo, max: hi };
                            } else {
                                if (lo < perScale[scaleKey].min) perScale[scaleKey].min = lo;
                                if (hi > perScale[scaleKey].max) perScale[scaleKey].max = hi;
                            }
                        }
                        for (const [key, range] of Object.entries(perScale)) {
                            if (range.min === range.max) {
                                u.setScale(key, { min: 0, max: 5 });
                            } else {
                                const pad = (range.max - range.min) * 0.1 || 1;
                                u.setScale(key, { min: range.min - pad, max: range.max + pad });
                            }
                        }

                        // Reset all interaction state.
                        if (xPanRef) xPanRef.current = false;
                        if (yAdjustedRef) yAdjustedRef.current = false;
                        if (lastXZoomMs) lastXZoomMs.current = 0;
                        if (lastYZoomMs) lastYZoomMs.current = 0;
                    };

                    u.root.addEventListener("wheel", onWheel, { passive: false });
                    u.root.addEventListener("mousedown", onYMouseDown);
                    u.root.addEventListener("dblclick", onDblClick);
                    window.addEventListener("mousemove", onYMouseMove);
                    window.addEventListener("mouseup", onYMouseUp);
                    cleanup = () => {
                        u.root.removeEventListener("wheel", onWheel);
                        u.root.removeEventListener("mousedown", onYMouseDown);
                        u.root.removeEventListener("dblclick", onDblClick);
                        window.removeEventListener("mousemove", onYMouseMove);
                        window.removeEventListener("mouseup", onYMouseUp);
                    };
                },
            ],
            destroy: [
                () => {
                    if (cleanup) cleanup();
                },
            ],
        },
    };
}

// Detector event markers: dashed line + dot at each event position.
// Reads directly from the engine (no store sync needed).
function detectorMarkersPlugin(): uPlot.Plugin {
    return {
        hooks: {
            drawClear: [
                (u: uPlot) => {
                    const events = useScopeStore.getState().getEngine().getDetectorEvents();
                    if (events.length === 0) return;

                    const ctx = u.ctx;
                    const xMin = u.scales.x.min as number;
                    const xMax = u.scales.x.max as number;

                    ctx.save();

                    for (const evt of events) {
                        // Only draw events in the visible X range
                        if (evt.timestampUs < xMin || evt.timestampUs > xMax) continue;

                        const x = u.valToPos(evt.timestampUs, "x");
                        const yTop = u.bbox.top;
                        const yBot = u.bbox.top + u.bbox.height;

                        const color = evt.channel === 'v' ? 'rgba(34,211,238,0.6)' : 'rgba(245,158,11,0.6)';

                        // Vertical dashed line
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1;
                        ctx.setLineDash([4, 4]);
                        ctx.beginPath();
                        ctx.moveTo(x, yTop);
                        ctx.lineTo(x, yBot);
                        ctx.stroke();

                        // Dot at the crossing value position
                        const yScale = evt.channel === 'v' ? 'yV' : 'yI';
                        const y = u.valToPos(evt.value, yScale);

                        ctx.setLineDash([]);
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(x, y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    ctx.restore();
                },
            ],
        },
    };
}

// Visual window band plugin: draws min/max bands + bright avg line per visible
// channel. Render-only — no data changes. Hides uPlot default series rendering
// (show:false) and replaces it with bucketed band + avg.
function visualBandPlugin(): uPlot.Plugin {
    const NUM_BUCKETS = 200;

    return {
        hooks: {
            draw: [
                (u: uPlot) => {
                    const ctx = u.ctx;
                    const channels = useScopeStore.getState().config.channels;

                    const xData = u.data[0] as Float64Array;
                    if (!xData || xData.length < 2) return;

                    const xMin = u.scales.x.min as number;
                    const xMax = u.scales.x.max as number;
                    const xRange = xMax - xMin;
                    const bucketWidth = xRange / NUM_BUCKETS;

                    ctx.save();

                    let dataIdx = 1;
                    const seriesInfo: { color: string; idx: number; scale: string }[] = [];
                    if (channels.v) { seriesInfo.push({ color: CHANNEL_COLORS.v, idx: dataIdx, scale: "yV" }); dataIdx++; }
                    if (channels.i) { seriesInfo.push({ color: CHANNEL_COLORS.i, idx: dataIdx, scale: "yI" }); dataIdx++; }
                    if (channels.w) { seriesInfo.push({ color: CHANNEL_COLORS.w, idx: dataIdx, scale: "yW" }); dataIdx++; }

                    for (const info of seriesInfo) {
                        const arr = u.data[info.idx] as Float64Array;
                        if (!arr || arr.length < 2) continue;

                        const buckets: { min: number; max: number; sum: number; count: number }[] = [];
                        for (let b = 0; b < NUM_BUCKETS; b++) {
                            buckets.push({ min: Infinity, max: -Infinity, sum: 0, count: 0 });
                        }

                        for (let k = 0; k < xData.length; k++) {
                            const t = xData[k];
                            if (t < xMin || t > xMax) continue;
                            const bucketIdx = Math.min(NUM_BUCKETS - 1, Math.floor((t - xMin) / bucketWidth));
                            const val = arr[k];
                            const b = buckets[bucketIdx];
                            if (val < b.min) b.min = val;
                            if (val > b.max) b.max = val;
                            b.sum += val;
                            b.count++;
                        }

                        const bandPath = new Path2D();
                        const avgPath = new Path2D();
                        let bandStarted = false;
                        let avgStarted = false;

                        // Forward pass: max band edge + avg line
                        for (let b = 0; b < NUM_BUCKETS; b++) {
                            const bucket = buckets[b];
                            if (bucket.count === 0) continue;

                            const tCenter = xMin + (b + 0.5) * bucketWidth;
                            const x = u.valToPos(tCenter, "x");
                            const avg = bucket.sum / bucket.count;
                            const yMax = u.valToPos(bucket.max, info.scale);
                            const yAvg = u.valToPos(avg, info.scale);

                            if (!bandStarted) { bandPath.moveTo(x, yMax); bandStarted = true; }
                            else { bandPath.lineTo(x, yMax); }

                            if (!avgStarted) { avgPath.moveTo(x, yAvg); avgStarted = true; }
                            else { avgPath.lineTo(x, yAvg); }
                        }

                        // Backward pass: min band edge (close the polygon)
                        for (let b = NUM_BUCKETS - 1; b >= 0; b--) {
                            const bucket = buckets[b];
                            if (bucket.count === 0) continue;
                            const tCenter = xMin + (b + 0.5) * bucketWidth;
                            const x = u.valToPos(tCenter, "x");
                            const yMin = u.valToPos(bucket.min, info.scale);
                            bandPath.lineTo(x, yMin);
                        }
                        bandPath.closePath();

                        // Fill: semi-transparent band
                        ctx.fillStyle = info.color + "20";
                        ctx.fill(bandPath);

                        // Stroke: thin band border
                        ctx.strokeStyle = info.color + "40";
                        ctx.lineWidth = 0.5;
                        ctx.stroke(bandPath);

                        // Stroke: bright avg line
                        ctx.strokeStyle = info.color;
                        ctx.lineWidth = 1.5;
                        ctx.stroke(avgPath);
                    }

                    ctx.restore();
                },
            ],
        },
    };
}

export function useScopeEngine(
    containerRef: RefObject<HTMLDivElement | null>,
    uRef: RefObject<uPlot | null>,
    channelKey: string,
): void {
    const rafRef = useRef<number | null>(null);
    const regionRef = useRef<RegionSelection | null>(null);
    // Separate tracking for X and Y so one interaction never breaks the other.
    const xPanRef = useRef(false); // kept for double-click reset; shift+pan removed
    const yAdjustedRef = useRef(false); // Y-gutter drag → permanent Y decouple
    const lastXZoomMs = useRef(0); // wheel-zoom X → temporary, auto-follow resumes after 2000ms idle
    const lastYZoomMs = useRef(0); // wheel-zoom Y → temporary, auto-range resumes after 2000ms idle
    // Track last applied Y scales to avoid spurious interaction-state resets.
    const lastVYScaleRef = useRef(useScopeStore.getState().config.vYScale);
    const lastIYScaleRef = useRef(useScopeStore.getState().config.iYScale);
    const lastWYScaleRef = useRef(useScopeStore.getState().config.wYScale);

    const region = useScopeStore((s) => s.region);
    const setRegion = useScopeStore((s) => s.setRegion);
    const vYScale = useScopeStore((s) => s.config.vYScale);
    const iYScale = useScopeStore((s) => s.config.iYScale);
    const wYScale = useScopeStore((s) => s.config.wYScale);

    // Keep latest region in a ref so the draw hook reads current value.
    useEffect(() => {
        regionRef.current = region;
    }, [region]);

    // Apply per-channel Y-scale changes live (no chart rebuild, keeps zoom).
    // Helper: apply a YScale config to a named uPlot scale.
    const applyYScale = (
        u: uPlot,
        scaleKey: string,
        yScale: YScale,
        lastRef: React.MutableRefObject<YScale>,
    ) => {
        const prev = lastRef.current;
        const changed = prev.auto !== yScale.auto || prev.min !== yScale.min || prev.max !== yScale.max;
        lastRef.current = yScale;
        if (!yScale.auto) {
            u.setScale(scaleKey, { min: yScale.min, max: yScale.max });
        }
        // Only reset user interaction state if the scale config actually changed.
        if (changed) {
            yAdjustedRef.current = false;
            lastYZoomMs.current = 0;
        }
    };

    useEffect(() => {
        const u = uRef.current;
        if (!u) return;
        applyYScale(u, "yV", vYScale, lastVYScaleRef);
    }, [vYScale]);

    useEffect(() => {
        const u = uRef.current;
        if (!u) return;
        applyYScale(u, "yI", iYScale, lastIYScaleRef);
    }, [iYScale]);

    useEffect(() => {
        const u = uRef.current;
        if (!u) return;
        applyYScale(u, "yW", wYScale, lastWYScaleRef);
    }, [wYScale]);

    // Init / rebuild the chart when the channel set changes.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const channels = useScopeStore.getState().config.channels;
        const seriesDefs = buildSeries(channels);

        const opts: uPlot.Options = {
            width: el.clientWidth || 800,
            height: el.clientHeight || 400,
            series: seriesDefs,
            scales: buildScales(channels),
            axes: buildAxes(channels),
            cursor: {
                drag: { x: true, y: false, setScale: false, dist: 5 },
            },
            // Hide uPlot's own selection box; we draw a custom region band.
            select: { show: false, left: 0, top: 0, width: 0, height: 0 },
            legend: { show: true },
            plugins: [wheelZoomPlugin(0.9, xPanRef, yAdjustedRef, lastXZoomMs, lastYZoomMs), tooltipPlugin(), visualBandPlugin(), detectorMarkersPlugin()],
            hooks: {
                // Drag finished → record the selected display-time window.
                setSelect: [
                    (u: uPlot) => {
                        const s = u.select;
                        if (s.width < 2) return; // ignore tiny/click drags
                        const t0 = u.posToVal(s.left, "x");
                        const t1 = u.posToVal(s.left + s.width, "x");
                        log("setSelect t0=%s t1=%s", t0, t1);
                        setRegion(t0, t1);
                    },
                ],
                // Draw the shaded region band behind the series every redraw.
                drawClear: [
                    (u: uPlot) => {
                        const r = regionRef.current;
                        if (!r) return;
                        const ctx = u.ctx;
                        const x0 = u.valToPos(r.tStartUs, "x");
                        const x1 = u.valToPos(r.tEndUs, "x");
                        const top = u.bbox.top;
                        const h = u.bbox.height;
                        ctx.save();
                        ctx.fillStyle = REGION_FILL;
                        ctx.fillRect(x0, top, x1 - x0, h);
                        ctx.strokeStyle = REGION_STROKE;
                        ctx.lineWidth = 1;
                        ctx.strokeRect(x0, top, x1 - x0, h);
                        ctx.restore();
                    },
                ],
            },
        };

        const initData: uPlot.AlignedData = [new Float64Array([0])];
        for (let s = 1; s < seriesDefs.length; s++) initData.push(new Float64Array([]));

        const u = new uPlot(opts, initData, el);
        uRef.current = u;
        log("chart built channels=%s size=%dx%d", channelKey, u.bbox.width, u.bbox.height);

        // Map each channel to its data-array index (index 0 = t).
        let dataIdx = 1;
        const vIdx = channels.v ? dataIdx++ : -1;
        const iIdx = channels.i ? dataIdx++ : -1;
        const wIdx = channels.w ? dataIdx++ : -1;

        // rAF loop: pull engine snapshot → setData. resetScales=false keeps zoom.
        const loop = () => {
            const snap = useScopeStore.getState().getEngine().snapshot();
            const data: uPlot.AlignedData = [snap.t];
            if (channels.v) data.push(snap.v);
            if (channels.i) data.push(snap.i);
            if (channels.w) data.push(snap.w);
            u.setData(data, false);

            const hz = useScopeStore.getState().config.hZoomSec;
            const config = useScopeStore.getState().config;
            const followLatest = config.followLatest;

            // X axis auto-follow: skipped when user has wheel-zoomed X
            // within the last 2000ms (temporary decouple).
            // Y interactions never block X.
            if (!xPanRef.current && (Date.now() - lastXZoomMs.current) > 2000 && snap.t.length > 0) {
                const maxXRange = useScopeStore.getState().config.bufferSec * 1_000_000;
                if (hz > 0) {
                    const effectiveHz = Math.min(hz, useScopeStore.getState().config.bufferSec);
                    const latest = snap.t[snap.t.length - 1];
                    if (followLatest) {
                        const t0 = latest - effectiveHz * 1_000_000;
                        u.setScale("x", { min: t0, max: latest });
                    } else {
                        const currentWidth = Math.min(
                            ((u.scales.x.max as number) - (u.scales.x.min as number)) || (effectiveHz * 1_000_000),
                            maxXRange,
                        );
                        const sxMin = u.scales.x.min as number;
                        const t0 = (sxMin == null || (sxMin === 0 && latest > 1000)) ? (latest - effectiveHz * 1_000_000) : sxMin;
                        const t1 = t0 + currentWidth;
                        u.setScale("x", { min: t0, max: t1 });
                    }
                } else {
                    let t0 = snap.t[0];
                    let t1 = snap.t[snap.t.length - 1];
                    if (t1 <= t0) t1 = t0 + 1; // avoid degenerate single-point range
                    u.setScale("x", { min: t0, max: t1 });
                }
                // Clamp visible range to bufferSec
                const visibleRange = (u.scales.x.max as number) - (u.scales.x.min as number);
                if (visibleRange > maxXRange) {
                    const center = ((u.scales.x.min as number) + (u.scales.x.max as number)) / 2;
                    u.setScale("x", { min: center - maxXRange / 2, max: center + maxXRange / 2 });
                }
            }

            // Y axis auto-range: blocked by Y-gutter drag (permanent) or
            // wheel-zoom Y within the last 2000ms (temporary).
            if (!yAdjustedRef.current && (Date.now() - lastYZoomMs.current) > 2000) {
                // Auto-range one scale from a data array.
                const autoRange = (idx: number, scaleKey: string, auto: boolean) => {
                    if (!auto) return;
                    if (snap.t.length === 0) {
                        u.setScale(scaleKey, { min: 0, max: 5 });
                        return;
                    }
                    const arr = data[idx] as Float64Array;
                    let lo = Infinity, hi = -Infinity;
                    for (let k = 0; k < arr.length; k++) {
                        const val = arr[k];
                        if (val < lo) lo = val;
                        if (val > hi) hi = val;
                    }
                    if (lo !== Infinity && lo !== hi) {
                        const pad = (hi - lo) * 0.1 || 1;
                        lo -= pad;
                        hi += pad;
                        u.setScale(scaleKey, { min: lo, max: hi });
                    }
                };

                if (vIdx >= 0) autoRange(vIdx, "yV", config.vYScale.auto);
                if (iIdx >= 0) autoRange(iIdx, "yI", config.iYScale.auto);
                if (wIdx >= 0) autoRange(wIdx, "yW", config.wYScale.auto);
            }

            // Out-of-range Y notification (once per channel)
            for (const ch of ['v', 'i', 'w'] as const) {
                const chIdx = ch === 'v' ? vIdx : ch === 'i' ? iIdx : wIdx;
                if (chIdx < 0) continue;
                const arr = data[chIdx] as Float64Array;
                if (!arr || arr.length === 0) continue;
                const scaleKey = ch === 'v' ? 'yV' : ch === 'i' ? 'yI' : 'yW';
                const s = (u.scales as Record<string, any>)[scaleKey];
                if (!s || s.min == null || s.max == null) continue;
                const yMin = s.min as number;
                const yMax = s.max as number;

                let outOfRange = false;
                for (let k = 0; k < arr.length; k++) {
                    const v = arr[k];
                    if (v < yMin || v > yMax) { outOfRange = true; break; }
                }

                if (outOfRange && !ooActive[ch]) {
                    ooActive[ch] = true;
                    const label = ch === 'v' ? 'Voltage' : ch === 'i' ? 'Current' : 'Power';
                    useScopeStore.getState().notify({
                        type: 'warning',
                        title: `${label} out of range`,
                        message: 'Data outside visible Y-axis. Double-click chart to reset.',
                        timeout: 0,
                    });
                } else if (!outOfRange && ooActive[ch]) {
                    ooActive[ch] = false;
                    // Dismiss all out-of-range notifications
                    const notifs = useScopeStore.getState().notifications;
                    for (const n of notifs) {
                        if (n.title?.includes('out of range')) {
                            useScopeStore.getState().dismissNotification(n.id);
                        }
                    }
                }
            }

            logLoop("loop snapLen=%s xRange=[%s,%s] hZoomSec=%s", snap.t.length, u.scales.x.min, u.scales.x.max, hz);
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);

        const ro = new ResizeObserver(() => {
            u.setSize({ width: el.clientWidth, height: el.clientHeight });
        });
        ro.observe(el);

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") useScopeStore.getState().clearRegion();
        };
        window.addEventListener("keydown", onKey);

        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            window.removeEventListener("keydown", onKey);
            ro.disconnect();
            u.destroy();
            uRef.current = null;
        };
        // channelKey drives rebuild; other deps are stable refs/getters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelKey]);
}
