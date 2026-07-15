// uPlot-based scope graph with separate V/I/W axes, envelope bands, and drag selection.
// Replaces the old Canvas 2D rAF implementation.

import React, { useRef, useEffect } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useScopeStore } from "../../store/scopeStore";
import { tierToLabel } from "../lib/hysteresis";
import type { BucketedTelemetryData } from "../types/workerTypes";

// ── Channel styling ──

const CHANNELS = {
    v: { stroke: "#FACC15", fill: "rgba(250, 204, 21, 0.12)", label: "V" },
    i: { stroke: "#22D3EE", fill: "rgba(34, 211, 238, 0.12)", label: "I" },
    w: { stroke: "#E879F9", fill: "rgba(232, 121, 249, 0.12)", label: "W" },
} as const;

// ── Data conversion ──

/** Convert BucketedTelemetryData → uPlot's columnar format (10 series). */
function toAlignedData(data: BucketedTelemetryData): uPlot.AlignedData {
    const n = data.timestamps.length;
    const wAvg = new Float64Array(n);
    const wMin = new Float64Array(n);
    const wMax = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const w = data.avgV[i] * data.avgI[i];
        wAvg[i] = w;
        const p1 = data.minV[i] * data.minI[i];
        const p2 = data.minV[i] * data.maxI[i];
        const p3 = data.maxV[i] * data.minI[i];
        const p4 = data.maxV[i] * data.maxI[i];
        wMin[i] = Math.min(p1, p2, p3, p4);
        wMax[i] = Math.max(p1, p2, p3, p4);
    }

    return [
        data.timestamps,   // [0] x
        data.avgV,          // [1] V avg
        data.minV,          // [2] V min (band low)
        data.maxV,          // [3] V max (band high)
        data.avgI,          // [4] I avg
        data.minI,          // [5] I min (band low)
        data.maxI,          // [6] I max (band high)
        wAvg,               // [7] W avg
        wMin,               // [8] W min (band low)
        wMax,               // [9] W max (band high)
    ];
}

// ── Axis formatters ──

function fmtTime(v: number): string {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "s";
    if (v >= 1_000) return (v / 1_000).toFixed(0) + "ms";
    return v.toFixed(0) + "µs";
}

function fmtCurrentByTier(v: number, tier: import("../lib/hysteresis").ScaleTier): string {
    const scaled = tier === "ua" ? v * 1_000_000 : tier === "ma" ? v * 1_000 : v;
    const label = tierToLabel(tier);
    if (tier === "ua") return scaled.toFixed(0) + " " + label;
    if (tier === "ma") return scaled.toFixed(2) + " " + label;
    return scaled.toFixed(3) + " " + label;
}

// ── ScopeCanvas component ──

export const ScopeCanvas: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const uplotRef = useRef<uPlot | null>(null);

    const latestData = useScopeStore((s) => s.latestData);
    const channels = useScopeStore((s) => s.config.channels);

    // 1. Create uPlot instance (once)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const width = Math.max(rect.width || 800, 200);
        const height = Math.max(rect.height || 400, 200);

        // Minimal 2-point placeholder so uPlot initialises cleanly
        const initData: uPlot.AlignedData = [
            new Float64Array([0, 1]),
            new Float32Array([0, 0]),
            new Float32Array([0, 0]),
            new Float32Array([0, 0]),
            new Float32Array([0, 0]),
            new Float32Array([0, 0]),
            new Float32Array([0, 0]),
            new Float64Array([0, 0]),
            new Float64Array([0, 0]),
            new Float64Array([0, 0]),
        ];

        const opts: uPlot.Options = {
            width,
            height,
            class: "scope-plot",
            pxAlign: true,

            // ── Scales ──
            scales: {
                x: { time: false },
                v: { auto: true, range: [0, null] },
                i: { auto: true, range: [0, null] },
                w: { auto: true, range: [0, null] },
            },

            // ── Series ──
            series: [
                {},                                                         // [0] x
                { scale: "v", stroke: CHANNELS.v.stroke, width: 1.5, label: "V", value: (_, v) => (v ?? 0).toFixed(3) + " V" },       // [1] V avg
                { scale: "v", fill: CHANNELS.v.fill, width: 0 },  // [2] V min (band, no line)
                { scale: "v", fill: CHANNELS.v.fill, width: 0 },  // [3] V max (band, no line)
                {
                    scale: "i", stroke: CHANNELS.i.stroke, width: 1.5, label: "I", value: (_, v) => {
                        const tier = useScopeStore.getState().hysteresisTier;
                        return fmtCurrentByTier(v ?? 0, tier);
                    }
                },        // [4] I avg
                { scale: "i", fill: CHANNELS.i.fill, width: 0 },  // [5] I min (band, no line)
                { scale: "i", fill: CHANNELS.i.fill, width: 0 },  // [6] I max (band, no line)
                { scale: "w", stroke: CHANNELS.w.stroke, width: 1.5, label: "W", value: (_, v) => (v ?? 0).toFixed(3) + " W" },       // [7] W avg
                { scale: "w", fill: CHANNELS.w.fill, width: 0 },  // [8] W min (band, no line)
                { scale: "w", fill: CHANNELS.w.fill, width: 0 },  // [9] W max (band, no line)
            ],

            // ── Envelope bands (min→max fill) ──
            bands: [
                { series: [2, 3], fill: CHANNELS.v.fill },
                { series: [5, 6], fill: CHANNELS.i.fill },
                { series: [8, 9], fill: CHANNELS.w.fill },
            ],

            // ── Axes ──
            axes: [
                {
                    scale: "x",
                    stroke: "#6B7280",
                    font: "10px monospace",
                    grid: { stroke: "rgba(75,85,99,0.25)", width: 0.5 },
                    ticks: { stroke: "#4B5563", width: 0.5 },
                    border: { stroke: "#4B5563", width: 0.5 },
                    values: (_self: uPlot, ticks: number[]) => ticks.map(fmtTime),
                    size: 28,
                },
                {
                    scale: "v",
                    stroke: "#9CA3AF",
                    font: "10px monospace",
                    label: "V",
                    labelFont: "bold 10px monospace",
                    labelGap: 4,
                    grid: { stroke: "rgba(75,85,99,0.25)", width: 0.5 },
                    ticks: { stroke: "#4B5563", width: 0.5 },
                    values: (_self: uPlot, ticks: number[]) => ticks.map((v) => v.toFixed(2)),
                    size: 52,
                },
                {
                    scale: "i",
                    stroke: "#9CA3AF",
                    font: "10px monospace",
                    label: "I",
                    labelFont: "bold 10px monospace",
                    labelGap: 4,
                    side: 1,
                    grid: { show: false },
                    ticks: { stroke: "#4B5563", width: 0.5 },
                    values: (_self: uPlot, ticks: number[]) => {
                        const tier = useScopeStore.getState().hysteresisTier;
                        return ticks.map((v) => fmtCurrentByTier(v, tier));
                    },
                    size: 56,
                },
                {
                    scale: "w",
                    stroke: "#9CA3AF",
                    font: "10px monospace",
                    label: "P",
                    labelFont: "bold 10px monospace",
                    labelGap: 4,
                    side: 1,
                    grid: { show: false },
                    ticks: { stroke: "#4B5563", width: 0.5 },
                    values: (_self: uPlot, ticks: number[]) => ticks.map((v) => v.toFixed(3)),
                    size: 56,
                },
            ],

            // ── Selection (drag for Phase D integration) ──
            select: {
                show: true,
                over: true,
                left: 0, top: 0, width: 0, height: 0,
            },

            cursor: {
                show: true,
                x: true,
                y: false,
                drag: { setScale: false, x: true, dist: 5 },
                points: {
                    show: false,
                },
                focus: { prox: -1 }, // disable y-focus
            },

            legend: { show: false },

            // ── Hooks ──
            hooks: {
                setSelect: [
                    (self: uPlot) => {
                        const { left, width } = self.select;
                        if (width > 5) {
                            const startVal = self.posToVal(left, "x");
                            const endVal = self.posToVal(left + width, "x");
                            const startTs = BigInt(Math.round(startVal));
                            const endTs = BigInt(Math.round(endVal));
                            const { engineRef } = useScopeStore.getState();
                            if (engineRef) {
                                const result = engineRef.getIntegration(startTs, endTs);
                                useScopeStore.getState().setSelection(result);
                            }
                        }
                    },
                ],
            },
        };

        const u = new uPlot(opts, initData, container);
        uplotRef.current = u;

        // ── Resize + dynamic bucket count ──
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width: w, height: h } = entry.contentRect;
                if (w > 0 && h > 0) {
                    u.setSize({ width: w, height: h });
                    // Update bucket count proportional to chart width (2× pixels, clamped [50,500])
                    const bc = Math.max(50, Math.min(500, Math.round(w * 2)));
                    useScopeStore.getState().setBucketCount(bc);
                }
            }
        });
        observer.observe(container);

        // ── Custom drag-end handler ──
        // uPlot fires setSelect during mousemove drag; we only want integration on mouseup.
        // Attach a flag so we can distinguish final mouseup from interim moves.
        let dragActive = false;
        const onDown = () => { dragActive = true; };
        const onUp = () => {
            if (!dragActive) return;
            dragActive = false;
            const { left, width } = u.select;
            if (width > 5) {
                const startVal = u.posToVal(left, "x");
                const endVal = u.posToVal(left + width, "x");
                const startTs = BigInt(Math.round(startVal));
                const endTs = BigInt(Math.round(endVal));
                const state = useScopeStore.getState();
                const { engineRef } = state;
                if (engineRef) {
                    const result = engineRef.getIntegration(startTs, endTs);
                    state.setSelection(result);
                }
            }
        };
        u.over.addEventListener("mousedown", onDown);
        u.over.addEventListener("mouseup", onUp);

        return () => {
            u.over.removeEventListener("mousedown", onDown);
            u.over.removeEventListener("mouseup", onUp);
            observer.disconnect();
            u.destroy();
            uplotRef.current = null;
        };
    }, []);

    // 2. Push new data into uPlot
    // Track whether we've ever received real data to control resetScales
    const hadDataRef = useRef(false);
    useEffect(() => {
        const u = uplotRef.current;
        if (!u) return;

        // Null/empty data → reset chart to empty placeholder
        if (!latestData || latestData.timestamps.length < 2) {
            if (hadDataRef.current) {
                hadDataRef.current = false;
                const t0 = performance.now();
                const initData: uPlot.AlignedData = [
                    new Float64Array([0, 1]),
                    new Float32Array([0, 0]),
                    new Float32Array([0, 0]),
                    new Float32Array([0, 0]),
                    new Float32Array([0, 0]),
                    new Float32Array([0, 0]),
                    new Float32Array([0, 0]),
                    new Float64Array([0, 0]),
                    new Float64Array([0, 0]),
                    new Float64Array([0, 0]),
                ];
                u.setData(initData, true);
                console.log("[perf] uPlot clear resetTime=" + (performance.now() - t0).toFixed(1) + "ms");
            }
            return;
        }

        const t0 = performance.now();
        const aligned = toAlignedData(latestData);
        const t1 = performance.now();
        // Always reset scales so the viewport tracks the current data window.
        // With getLatestWindow returning a fixed-span window, the x-range
        // stays stable (no accumulator growth) and y-range is consistent.
        hadDataRef.current = true;
        u.setData(aligned, true);
        const t2 = performance.now();
        console.log(
            "[perf] uPlot toAligned=" + (t1 - t0).toFixed(1) + "ms" +
            " setData=" + (t2 - t1).toFixed(1) + "ms" +
            " total=" + (t2 - t0).toFixed(1) + "ms" +
            " points=" + latestData.timestamps.length
        );
    }, [latestData]);

    // 3. Toggle channel visibility
    useEffect(() => {
        const u = uplotRef.current;
        if (!u) return;

        u.setSeries(1, { show: channels.v });
        u.setSeries(2, { show: channels.v });
        u.setSeries(3, { show: channels.v });
        u.setSeries(4, { show: channels.i });
        u.setSeries(5, { show: channels.i });
        u.setSeries(6, { show: channels.i });
        u.setSeries(7, { show: channels.w });
        u.setSeries(8, { show: channels.w });
        u.setSeries(9, { show: channels.w });
    }, [channels]);

    // 4. Esc clears selection
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                useScopeStore.getState().setSelection(null);
                const u = uplotRef.current;
                if (u) u.setSelect({ left: 0, top: 0, width: 0, height: 0 });
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    // ── Render ──
    const hasData = !!(latestData && latestData.timestamps.length >= 2);
    const activeChs = [
        { key: "v", ...CHANNELS.v, on: channels.v },
        { key: "i", ...CHANNELS.i, on: channels.i },
        { key: "w", ...CHANNELS.w, on: channels.w },
    ].filter((c) => c.on);

    return (
        <div ref={containerRef} className="w-full h-full relative bg-gray-900">
            {/* Channel legend */}
            {activeChs.length > 0 && (
                <div className="absolute top-2 left-2 flex gap-3 text-[10px] font-mono pointer-events-none z-10 select-none">
                    {activeChs.map((ch) => (
                        <span key={ch.key} style={{ color: ch.stroke }}>{ch.label}</span>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!hasData && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <span className="text-gray-500 text-sm font-mono">Press Simulate to start</span>
                </div>
            )}
        </div>
    );
};
