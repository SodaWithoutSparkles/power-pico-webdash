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
import type { ScopeConfig } from "./engineTypes";
import { createDebug, createDebugThrottled } from "../utils/debug";

const log = createDebug("render");
const logLoop = createDebugThrottled("render:loop", 500);

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
        series.push({ label: CHANNEL_LABELS.v, stroke: CHANNEL_COLORS.v, width: 2, points: { show: false } });
    if (channels.i)
        series.push({ label: CHANNEL_LABELS.i, stroke: CHANNEL_COLORS.i, width: 2, points: { show: false } });
    if (channels.w)
        series.push({ label: CHANNEL_LABELS.w, stroke: CHANNEL_COLORS.w, width: 2, points: { show: false } });
    return series;
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
                        if (series.show === false) continue;
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

// Wheel = zoom x (time axis) about the cursor.
// Shift+wheel = pan x.
// Drag on the Y-axis gutter = pan the vertical offset.
// uPlot has no built-in wheel zoom or axis-drag pan, so both are custom.
//
// X and Y interaction flags are kept separate so Y gutter drag never
// disables X auto-follow (the rAF loop uses each independently).
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

                    const onWheel = (e: WheelEvent) => {
                        e.preventDefault();
                        if (!u.over) return;

                        // Shift+wheel → pan x-axis (permanent decouple).
                        if (e.shiftKey) {
                            const sx = u.scales.x;
                            if (sx.min == null || sx.max == null) return;
                            const sxMin = sx.min as number;
                            const sxMax = sx.max as number;
                            const oxRange = sxMax - sxMin;
                            const pan = (e.deltaY < 0 ? -1 : 1) * oxRange * 0.1;
                            u.setScale("x", { min: sxMin + pan, max: sxMax + pan });
                            if (xPanRef) xPanRef.current = true;
                            return;
                        }

                        const overRect = u.over.getBoundingClientRect();

                        // Y-axis gutter → zoom Y about cursor (temporary decouple).
                        if (e.clientX < overRect.left) {
                            const sy = u.scales.y;
                            if (sy.min == null || sy.max == null) return;
                            const top = e.clientY - overRect.top;
                            const anchor = u.posToVal(top, "y");
                            const oyRange = (sy.max as number) - (sy.min as number);
                            const nyRange = e.deltaY < 0 ? oyRange * factor : oyRange / factor;
                            const topPct = top / overRect.height;
                            const nyMin = anchor - topPct * nyRange;
                            const nyMax = nyMin + nyRange;
                            u.setScale("y", { min: nyMin, max: nyMax });
                            if (lastYZoomMs) lastYZoomMs.current = Date.now();
                            return;
                        }

                        // Wheel → zoom X (time) about the cursor position (temporary decouple).
                        const sx = u.scales.x;
                        if (sx.min == null || sx.max == null) return;
                        const left = e.clientX - overRect.left;
                        const leftPct = left / overRect.width;
                        const xVal = u.posToVal(left, "x");
                        const oxRange = (sx.max as number) - (sx.min as number);
                        const nxRange = e.deltaY < 0 ? oxRange * factor : oxRange / factor;
                        const nxMin = xVal - leftPct * nxRange;
                        const nxMax = nxMin + nxRange;
                        u.setScale("x", { min: nxMin, max: nxMax });
                        if (lastXZoomMs) lastXZoomMs.current = Date.now();
                    };

                    // Drag on the Y-axis gutter → pan the vertical offset.
                    const onYMouseDown = (e: MouseEvent) => {
                        const overRect = u.over.getBoundingClientRect();
                        if (e.clientX >= overRect.left) return; // only the Y-axis gutter
                        dragging = true;
                        startClientY = e.clientY;
                        startOverTop = overRect.top;
                        if (u.scales.y.min == null || u.scales.y.max == null) return;
                        startMin = u.scales.y.min as number;
                        startMax = u.scales.y.max as number;
                        if (yAdjustedRef) yAdjustedRef.current = true;
                        e.preventDefault();
                    };
                    const onYMouseMove = (e: MouseEvent) => {
                        if (!dragging || !u.over) return;
                        const yStart = u.posToVal(startClientY - startOverTop, "y");
                        const yNow = u.posToVal(e.clientY - startOverTop, "y");
                        const delta = yStart - yNow; // keep the value under the cursor fixed
                        u.setScale("y", { min: startMin + delta, max: startMax + delta });
                    };
                    const onYMouseUp = () => {
                        dragging = false;
                    };

                    // Double-click resets both axes to data-based bounds.
                    const onDblClick = () => {
                        // X bounds from data
                        const xData = u.data[0];
                        const xMin = xData.length > 0 ? xData[0] : 0;
                        const xMax = xData.length > 0 ? xData[xData.length - 1] : 1_000_000;
                        u.setScale("x", { min: xMin, max: xMax });

                        // Y bounds from visible series
                        let yMin = Infinity;
                        let yMax = -Infinity;
                        for (let s = 1; s < u.series.length; s++) {
                            const arr = u.data[s];
                            if (!arr || u.series[s].show === false) continue;
                            for (let k = 0; k < arr.length; k++) {
                                const val = arr[k];
                                if (val == null) continue;
                                if (val < yMin) yMin = val;
                                if (val > yMax) yMax = val;
                            }
                        }
                        if (yMin === Infinity || yMax === -Infinity || yMin === yMax) {
                            u.setScale("y", { min: 0, max: 5 });
                        } else {
                            const pad = (yMax - yMin) * 0.1 || 1;
                            u.setScale("y", { min: yMin - pad, max: yMax + pad });
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

export function useScopeEngine(
    containerRef: RefObject<HTMLDivElement | null>,
    channelKey: string,
): void {
    const uRef = useRef<uPlot | null>(null);
    const rafRef = useRef<number | null>(null);
    const regionRef = useRef<RegionSelection | null>(null);
    // Separate tracking for X and Y so one interaction never breaks the other.
    const xPanRef = useRef(false); // shift+wheel pan → permanent X decouple
    const yAdjustedRef = useRef(false); // Y-gutter drag → permanent Y decouple
    const lastXZoomMs = useRef(0); // wheel-zoom X → temporary, auto-follow resumes after 2000ms idle
    const lastYZoomMs = useRef(0); // wheel-zoom Y → temporary, auto-range resumes after 2000ms idle
    const lastVScaleRef = useRef(useScopeStore.getState().config.vScale); // track last applied vScale to avoid spurious resets

    const region = useScopeStore((s) => s.region);
    const setRegion = useScopeStore((s) => s.setRegion);
    const vScale = useScopeStore((s) => s.config.vScale);

    // Keep latest region in a ref so the draw hook reads current value.
    useEffect(() => {
        regionRef.current = region;
    }, [region]);

    // Apply vertical-scale changes live (no chart rebuild, keeps zoom).
    useEffect(() => {
        const u = uRef.current;
        if (!u) return;

        const prev = lastVScaleRef.current;
        const vChanged = prev.auto !== vScale.auto || prev.min !== vScale.min || prev.max !== vScale.max;
        lastVScaleRef.current = vScale;

        u.setScale("y", (vScale.auto ? { min: 0, max: 5 } : { min: vScale.min, max: vScale.max }) as unknown as { min: number; max: number });

        // Only reset user interaction state if vScale actually changed.
        if (vChanged) {
            yAdjustedRef.current = false;
            lastYZoomMs.current = 0;
        }
    }, [vScale]);

    // Init / rebuild the chart when the channel set changes.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const channels = useScopeStore.getState().config.channels;
        const vScale = useScopeStore.getState().config.vScale;
        const seriesDefs = buildSeries(channels);

        // When auto-ranging with no data yet, start at a sensible 0–5 V window
        // instead of uPlot's degenerate empty-data range.
        const yScale: uPlot.Scale = vScale.auto
            ? { min: 0, max: 5 }
            : { min: vScale.min, max: vScale.max };

        const opts: uPlot.Options = {
            width: el.clientWidth || 800,
            height: el.clientHeight || 400,
            series: seriesDefs,
            scales: {
                x: { time: false },
                y: yScale,
            },
            axes: [
                {
                    values: xAxisValues,
                    label: "Time (s)",
                    stroke: AXIS,
                    grid: { stroke: GRID },
                    ticks: { stroke: GRID },
                },
                {
                    stroke: AXIS,
                    grid: { stroke: GRID },
                    ticks: { stroke: GRID },
                },
            ],
            cursor: {
                drag: { x: true, y: false, setScale: false, dist: 5 },
            },
            // Hide uPlot's own selection box; we draw a custom region band.
            select: { show: false, left: 0, top: 0, width: 0, height: 0 },
            legend: { show: true },
            plugins: [wheelZoomPlugin(0.9, xPanRef, yAdjustedRef, lastXZoomMs, lastYZoomMs), tooltipPlugin()],
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

        // rAF loop: pull engine snapshot → setData. resetScales=false keeps zoom.
        const loop = () => {
            const snap = useScopeStore.getState().getEngine().snapshot();
            const data: uPlot.AlignedData = [snap.t];
            if (channels.v) data.push(snap.v);
            if (channels.i) data.push(snap.i);
            if (channels.w) data.push(snap.w);
            u.setData(data, false);

            const hz = useScopeStore.getState().config.hZoomSec;
            const vScale = useScopeStore.getState().config.vScale;
            const vZoom = useScopeStore.getState().config.vZoom;
            const followLatest = useScopeStore.getState().config.followLatest;

            // X axis auto-follow: skipped when user has shift+wheel-panned
            // (permanent) or wheel-zoomed X within the last 2000ms (temporary).
            // Y interactions never block X.
            if (!xPanRef.current && (Date.now() - lastXZoomMs.current) > 2000 && snap.t.length > 0) {
                if (hz > 0) {
                    const latest = snap.t[snap.t.length - 1];
                    if (followLatest) {
                        const t0 = latest - hz * 1_000_000;
                        u.setScale("x", { min: t0, max: latest });
                    } else {
                        const currentWidth = ((u.scales.x.max as number) - (u.scales.x.min as number)) || (hz * 1_000_000);
                        const sxMin = u.scales.x.min as number;
                        const t0 = (sxMin == null || (sxMin === 0 && latest > 1000)) ? (latest - hz * 1_000_000) : sxMin;
                        const t1 = t0 + currentWidth;
                        u.setScale("x", { min: t0, max: t1 });
                    }
                } else {
                    let t0 = snap.t[0];
                    let t1 = snap.t[snap.t.length - 1];
                    if (t1 <= t0) t1 = t0 + 1; // avoid degenerate single-point range
                    u.setScale("x", { min: t0, max: t1 });
                }
            }

            // Y axis auto-range: blocked by Y-gutter drag (permanent) or
            // wheel-zoom Y within the last 2000ms (temporary).
            if (!yAdjustedRef.current && (Date.now() - lastYZoomMs.current) > 2000) {
                if (snap.t.length === 0) {
                    if (vScale.auto) u.setScale("y", { min: 0, max: 5 });
                } else if (vScale.auto) {
                    let lo = Infinity;
                    let hi = -Infinity;
                    for (let s = 1; s < data.length; s++) {
                        const arr = data[s] as Float64Array;
                        for (let k = 0; k < arr.length; k++) {
                            const val = arr[k];
                            if (val < lo) lo = val;
                            if (val > hi) hi = val;
                        }
                    }
                    if (lo !== Infinity) {
                        const pad = (hi - lo) * 0.1 || 1;
                        lo -= pad;
                        hi += pad;
                        const mid = (lo + hi) / 2;
                        const safeZoom = Math.max(0.1, vZoom);
                        const half = ((hi - lo) / 2) / safeZoom;
                        u.setScale("y", { min: mid - half, max: mid + half });
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
