// Mini-map preview overlay for the scope chart. Shows the full buffer as a
// miniature timeline with the current view window highlighted. Appears only
// when the chart is zoomed in (visible X range < full data range).

import { useRef, useEffect, useCallback, useState } from "react";
import uPlot from "uplot";
import { useScopeStore } from "../store/scopeStore";

const CHANNEL_COLORS: Record<string, string> = { v: "#22d3ee", i: "#f59e0b", w: "#a78bfa" };
const PREVIEW_W = 200;
const PREVIEW_H = 80;
const GRID = "#374151";
const VIEW_FILL = "rgba(34,197,94,0.25)";
const VIEW_STROKE = "rgba(34,197,94,0.6)";

interface ZoomedPreviewProps {
    uRef: React.RefObject<uPlot | null>;
}

export function ZoomedPreview({ uRef }: ZoomedPreviewProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const [visible, setVisible] = useState(false);

    // Draw loop: runs on rAF to keep the preview in sync with the chart.
    // Visibility is driven from here (via state) because zoom changes live in
    // uPlot's scales, not in React state, so a render-time check would be stale.
    useEffect(() => {
        const loop = () => {
            const u = uRef.current;
            const canvas = canvasRef.current;

            if (!u) {
                rafRef.current = requestAnimationFrame(loop);
                return;
            }

            const snap = useScopeStore.getState().getEngine().snapshot();
            const dataLen = snap.t.length;

            if (dataLen < 2) {
                setVisible((v) => (v ? false : v));
                rafRef.current = requestAnimationFrame(loop);
                return;
            }

            const dataStart = snap.t[0];
            const dataEnd = snap.t[dataLen - 1];
            const dataRange = dataEnd - dataStart;

            const xMin = u.scales.x.min as number;
            const xMax = u.scales.x.max as number;
            const visibleRange = xMax - xMin;

            // Show only when meaningfully zoomed in (visible range < full range).
            const isZoomed = visibleRange < dataRange - 1;
            setVisible((v) => (v === isZoomed ? v : isZoomed));

            if (!isZoomed || !canvas) {
                rafRef.current = requestAnimationFrame(loop);
                return;
            }

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                rafRef.current = requestAnimationFrame(loop);
                return;
            }

            ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

            // Grid lines (matching uPlot's grid color).
            ctx.strokeStyle = GRID;
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= 4; i++) {
                const y = (PREVIEW_H / 4) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(PREVIEW_W, y);
                ctx.stroke();
            }

            const toX = (t: number) => ((t - dataStart) / dataRange) * PREVIEW_W;

            const channels = useScopeStore.getState().config.channels;
            const chKeys = ["v", "i", "w"] as const;

            for (const key of chKeys) {
                if (!channels[key]) continue;
                const arr = snap[key];
                if (!arr || arr.length < 2) continue;

                // Per-channel Y normalization so each trace fits the preview height.
                let chMin = Infinity;
                let chMax = -Infinity;
                for (let k = 0; k < arr.length; k++) {
                    const v = arr[k];
                    if (v < chMin) chMin = v;
                    if (v > chMax) chMax = v;
                }
                if (chMin === chMax) {
                    chMin -= 0.1;
                    chMax += 0.1;
                }
                const margin = (chMax - chMin) * 0.1 || 1;
                chMin -= margin;
                chMax += margin;
                const toY = (v: number) => PREVIEW_H - ((v - chMin) / (chMax - chMin)) * PREVIEW_H;

                // Draw a simplified path (one point per horizontal pixel).
                const step = Math.max(1, Math.floor(arr.length / PREVIEW_W));
                ctx.strokeStyle = CHANNEL_COLORS[key];
                ctx.lineWidth = 1;
                ctx.beginPath();
                let first = true;
                for (let k = 0; k < arr.length; k += step) {
                    const x = toX(snap.t[k]);
                    const y = toY(arr[k]);
                    if (first) {
                        ctx.moveTo(x, y);
                        first = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
            }

            // Current view window overlay.
            const vx0 = toX(xMin);
            const vx1 = toX(xMax);
            ctx.fillStyle = VIEW_FILL;
            ctx.fillRect(vx0, 0, vx1 - vx0, PREVIEW_H);
            ctx.strokeStyle = VIEW_STROKE;
            ctx.lineWidth = 1;
            ctx.strokeRect(vx0, 0, vx1 - vx0, PREVIEW_H);

            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [uRef]);

    const getEventX = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return 0;
        const rect = canvas.getBoundingClientRect();
        return e.clientX - rect.left;
    }, []);

    // Click anywhere → jump the view window, centered on the click.
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            const u = uRef.current;
            if (!u) return;

            const snap = useScopeStore.getState().getEngine().snapshot();
            if (snap.t.length === 0) return;

            const dataStart = snap.t[0];
            const dataEnd = snap.t[snap.t.length - 1];
            const dataRange = dataEnd - dataStart;
            const canvasX = getEventX(e);
            const t = dataStart + (canvasX / PREVIEW_W) * dataRange;

            const xMin = u.scales.x.min as number;
            const xMax = u.scales.x.max as number;
            const halfRange = (xMax - xMin) / 2;

            let newMin = t - halfRange;
            let newMax = t + halfRange;

            // Clamp to data bounds.
            if (newMin < dataStart) {
                newMin = dataStart;
                newMax = newMin + (xMax - xMin);
            }
            if (newMax > dataEnd) {
                newMax = dataEnd;
                newMin = newMax - (xMax - xMin);
            }

            u.setScale("x", { min: newMin, max: newMax });
            // ponytail: click-to-jump only. Drag-to-scroll adds complexity for
            // minimal UX gain; the main chart already supports wheel/drag pan.
        },
        [uRef, getEventX],
    );

    // Double-click → reset zoom to the full buffer.
    const handleDoubleClick = useCallback(() => {
        const u = uRef.current;
        if (!u) return;
        const snap = useScopeStore.getState().getEngine().snapshot();
        if (snap.t.length === 0) return;
        u.setScale("x", { min: snap.t[0], max: snap.t[snap.t.length - 1] });
        // Reset Y scales to data bounds too.
        for (let s = 1; s < u.series.length; s++) {
            const scale = u.series[s].scale;
            if (!scale) continue;
            const arr = u.data[s] as Float64Array;
            if (!arr || arr.length === 0) continue;
            let lo = Infinity;
            let hi = -Infinity;
            for (let k = 0; k < arr.length; k++) {
                const v = arr[k];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            if (lo !== Infinity && lo !== hi) {
                const pad = (hi - lo) * 0.1 || 1;
                u.setScale(scale, { min: lo - pad, max: hi + pad });
            }
        }
    }, [uRef]);

    if (!visible) return null;

    return (
        <div
            className="absolute bottom-3 right-3 z-20 rounded overflow-hidden border border-gray-600"
            style={{ background: "rgba(17,24,39,0.85)", width: PREVIEW_W, height: PREVIEW_H }}
        >
            <canvas
                ref={canvasRef}
                width={PREVIEW_W}
                height={PREVIEW_H}
                style={{ width: PREVIEW_W, height: PREVIEW_H, cursor: "pointer" }}
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            />
        </div>
    );
}
