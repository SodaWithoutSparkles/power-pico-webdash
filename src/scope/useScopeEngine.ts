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

// Compact wheel-zoom plugin (x + y). uPlot has no built-in wheel zoom.
function wheelZoomPlugin(factor = 0.9): uPlot.Plugin {
    return {
        hooks: {
            ready: [
                (u: uPlot) => {
                    u.over.addEventListener(
                        "wheel",
                        (e: WheelEvent) => {
                            e.preventDefault();
                            const sx = u.scales.x;
                            const sy = u.scales.y;
                            if (sx.min == null || sx.max == null || sy.min == null || sy.max == null) return;
                            const left = u.cursor.left ?? 0;
                            const top = u.cursor.top ?? 0;
                            const leftPct = left / u.bbox.width;
                            const btmPct = 1 - top / u.bbox.height;
                            const xVal = u.posToVal(left, "x");
                            const yVal = u.posToVal(top, "y");
                            const oxRange = sx.max - sx.min;
                            const oyRange = sy.max - sy.min;
                            const nxRange = e.deltaY < 0 ? oxRange * factor : oxRange / factor;
                            const nyRange = e.deltaY < 0 ? oyRange * factor : oyRange / factor;
                            const nxMin = xVal - leftPct * nxRange;
                            const nxMax = nxMin + nxRange;
                            const nyMin = yVal - btmPct * nyRange;
                            const nyMax = nyMin + nyRange;
                            u.batch(() => {
                                u.setScale("x", { min: nxMin, max: nxMax } as { min: number; max: number });
                                u.setScale("y", { min: nyMin, max: nyMax } as { min: number; max: number });
                            });
                        },
                        { passive: false },
                    );
                    // Double-click resets zoom to auto-range.
                    u.over.addEventListener("dblclick", () => {
                        u.setScale("x", { min: null, max: null } as unknown as { min: number; max: number });
                        u.setScale("y", { min: null, max: null } as unknown as { min: number; max: number });
                    });
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

    const region = useScopeStore((s) => s.region);
    const setRegion = useScopeStore((s) => s.setRegion);

    // Keep latest region in a ref so the draw hook reads current value.
    useEffect(() => {
        regionRef.current = region;
    }, [region]);

    // Init / rebuild the chart when the channel set changes.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const channels = useScopeStore.getState().config.channels;
        const vScale = useScopeStore.getState().config.vScale;

        const yScale: uPlot.Scale = vScale.auto
            ? { auto: true }
            : { min: vScale.min, max: vScale.max };

        const opts: uPlot.Options = {
            width: el.clientWidth || 800,
            height: el.clientHeight || 400,
            series: buildSeries(channels),
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
            plugins: [wheelZoomPlugin()],
            hooks: {
                // Drag finished → record the selected display-time window.
                setSelect: [
                    (u: uPlot) => {
                        const s = u.select;
                        if (s.width < 2) return; // ignore tiny/click drags
                        const t0 = u.posToVal(s.left, "x");
                        const t1 = u.posToVal(s.left + s.width, "x");
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

        const u = new uPlot(opts, [[0], [], [], []], el);
        uRef.current = u;

        // rAF loop: pull engine snapshot → setData. resetScales=false keeps zoom.
        const loop = () => {
            const snap = useScopeStore.getState().getEngine().snapshot();
            const data: uPlot.AlignedData = [snap.t];
            if (channels.v) data.push(snap.v);
            if (channels.i) data.push(snap.i);
            if (channels.w) data.push(snap.w);
            u.setData(data, false);

            // Horizontal zoom: pin x window to [latest - hZoomSec, latest].
            // Only when user hasn't manually wheel-zoomed (x scale at auto).
            const hz = useScopeStore.getState().config.hZoomSec;
            const sx = u.scales.x;
            if (hz > 0 && snap.t.length > 0 && sx.min == null && sx.max == null) {
                const latest = snap.t[snap.t.length - 1];
                u.setScale("x", { min: latest - hz * 1_000_000, max: latest });
            }
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
