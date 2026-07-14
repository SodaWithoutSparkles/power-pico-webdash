// Canvas 2D graph rendering engine for scope telemetry.
// Renders V/I/W envelope bands + average lines at 60 FPS via rAF.

import React, { useRef, useEffect, useCallback } from "react";
import { useScopeStore } from "../store/scopeStore";
import { createHysteresisState, updateScaleDelta } from "./hysteresis";
import type { ScaleTier, HysteresisState } from "./hysteresis";

const GRID_COLOR = "rgba(75, 85, 99, 0.5)";
const BG_COLOR = "#111827";
const TEXT_COLOR = "#9CA3AF";
const AXIS_COLOR = "#6B7280";

interface ChannelStyle {
    label: string;
    fill: string;
    stroke: string;
    enabled: boolean;
}

export const ScopeCanvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const hysteresisRef = useRef<HysteresisState>(createHysteresisState());
    const lastTimeRef = useRef(0);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const animFrameRef = useRef(0);

    const latestData = useScopeStore((s) => s.latestData);
    const channels = useScopeStore((s) => s.config.channels);
    const status = useScopeStore((s) => s.status);

    const styles: ChannelStyle[] = [
        { label: "V", fill: "rgba(250, 204, 21, 0.15)", stroke: "#FACC15", enabled: channels.v },
        { label: "I", fill: "rgba(34, 211, 238, 0.15)", stroke: "#22D3EE", enabled: channels.i },
        { label: "W", fill: "rgba(232, 121, 249, 0.15)", stroke: "#E879F9", enabled: channels.w },
    ];

    // Resize observer
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const dpr = window.devicePixelRatio || 1;
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
                const ctx = canvas.getContext("2d");
                if (ctx) ctx.scale(dpr, dpr);
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // Draw loop
    useEffect(() => {
        let running = true;

        const draw = (time: number) => {
            if (!running) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            const w = canvas.width / (window.devicePixelRatio || 1);
            const h = canvas.height / (window.devicePixelRatio || 1);

            // Clear
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = BG_COLOR;
            ctx.fillRect(0, 0, w, h);

            drawGrid(ctx, w, h);

            if (latestData && latestData.timestamps.length > 1) {
                // Compute peak current for hysteresis
                let peakI = 0;
                for (let i = 0; i < latestData.timestamps.length; i++) {
                    const absI = Math.abs(Math.max(latestData.maxI[i], Math.abs(latestData.minI[i])));
                    if (absI > peakI) peakI = absI;
                }

                // Update hysteresis with time delta
                const dt = lastTimeRef.current ? time - lastTimeRef.current : 16;
                lastTimeRef.current = time;
                hysteresisRef.current = updateScaleDelta(hysteresisRef.current, peakI, dt);

                const scaleTier = hysteresisRef.current.tier;

                // Determine Y range from data
                let maxVal = 0;
                let minVal = Infinity;
                if (channels.v) {
                    for (let i = 0; i < latestData.timestamps.length; i++) {
                        if (latestData.maxV[i] > maxVal) maxVal = latestData.maxV[i];
                        if (latestData.minV[i] < minVal) minVal = latestData.minV[i];
                    }
                }
                // For I and W, convert to scale tier units
                let maxIA = 0;
                if (channels.i) {
                    for (let i = 0; i < latestData.timestamps.length; i++) {
                        const peak = Math.max(Math.abs(latestData.maxI[i]), Math.abs(latestData.minI[i]));
                        if (peak > maxIA) maxIA = peak;
                    }
                }
                if (channels.w) {
                    for (let i = 0; i < latestData.timestamps.length; i++) {
                        const peak = Math.max(Math.abs(latestData.maxI[i]), Math.abs(latestData.minI[i]));
                        const wVal = latestData.avgV[i] * peak;
                        if (wVal > maxVal) maxVal = wVal;
                    }
                }

                const margin = maxVal * 0.1 || 1;
                const yMax = maxVal + margin;
                const yMin = Math.max(0, minVal - margin);

                // Draw each enabled channel
                const channelData = [
                    { label: "V", avg: latestData.avgV, min: latestData.minV, max: latestData.maxV, style: styles[0] },
                    { label: "I", avg: latestData.avgI, min: latestData.minI, max: latestData.maxI, style: styles[1] },
                    { label: "W", avg: null, min: null, max: null, style: styles[2] }, // power is computed
                ];

                const visibleChannels = channelData.filter((c) => c.style.enabled);

                for (const ch of visibleChannels) {
                    if (!ch.avg) continue; // skip W for now — power is V*I
                    drawChannel(ctx, w, h, ch.avg, ch.min, ch.max, yMin, yMax, ch.style);
                }

                // Draw axis labels
                drawYLabel(ctx, scaleTier, yMax, yMin);
                drawXTimestamps(ctx, w, h, latestData.timestamps);
            }

            // Show idle message when no data
            if (!latestData || latestData.timestamps.length === 0) {
                ctx.fillStyle = TEXT_COLOR;
                ctx.font = "14px monospace";
                ctx.textAlign = "center";
                ctx.fillText("Press Simulate to start", w / 2, h / 2);
            }

            animFrameRef.current = requestAnimationFrame(draw);
        };

        animFrameRef.current = requestAnimationFrame(draw);
        return () => {
            running = false;
            cancelAnimationFrame(animFrameRef.current);
        };
    }, [latestData, channels, status]);

    // Mouse drag-select
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
    }, []);

    const handleWheel = useCallback((_e: React.WheelEvent) => {
        // Will implement zoom in future
    }, []);

    const handleMouseMove = useCallback((_e: React.MouseEvent) => {
        if (!isDraggingRef.current) return;
        // Drag selection visual will be drawn in future
    }, []);

    const handleMouseUp = useCallback((_e: React.MouseEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        // Will trigger integration request in Phase D
    }, []);

    return (
        <div ref={containerRef} className="w-full h-full relative bg-gray-900">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
            />
            {/* Channel color legend */}
            <div className="absolute top-2 left-2 flex gap-3 text-[10px] font-mono pointer-events-none">
                {styles.filter((s) => s.enabled).map((s) => (
                    <span key={s.label} style={{ color: s.stroke }}>
                        {s.label}
                    </span>
                ))}
            </div>
        </div>
    );
};

// ── Drawing helpers ──

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;

    // Horizontal grid (5 lines)
    for (let i = 0; i <= 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Vertical grid (6 lines)
    for (let i = 0; i <= 6; i++) {
        const x = (w / 6) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
}

function drawChannel(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    avg: Float32Array | Float64Array,
    min: Float32Array | Float64Array,
    max: Float32Array | Float64Array,
    yMin: number,
    yMax: number,
    style: ChannelStyle,
) {
    const n = avg.length;
    if (n < 2) return;
    const yRange = yMax - yMin || 1;

    // Map value to canvas Y
    const toY = (v: number) => h - ((v - yMin) / yRange) * h;
    const toX = (i: number) => (i / (n - 1)) * w;

    // Draw envelope fill (between min and max)
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(max[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(max[i]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(toX(i), toY(min[i]));
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();

    // Draw average line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(avg[0]));
    for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(avg[i]));
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawYLabel(ctx: CanvasRenderingContext2D, tier: ScaleTier, _yMax: number, _yMin: number) {
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const prefix = tier === "ua" ? "µ" : tier === "ma" ? "m" : "";
    ctx.fillText(`${prefix}`, 8, 4);
}

function drawXTimestamps(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    timestamps: Float64Array,
) {
    const n = timestamps.length;
    if (n < 2) return;
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    // Show a few time labels
    const steps = Math.min(6, n - 1);
    const interval = Math.floor((n - 1) / steps);

    for (let i = 0; i <= steps; i++) {
        const idx = Math.min(i * interval, n - 1);
        const ts = timestamps[idx];
        const x = (idx / (n - 1)) * w;
        let label: string;
        if (ts >= 1_000_000) {
            label = `${(ts / 1_000_000).toFixed(1)}s`;
        } else if (ts >= 1_000) {
            label = `${(ts / 1_000).toFixed(0)}ms`;
        } else {
            label = `${ts.toFixed(0)}µs`;
        }
        ctx.fillText(label, x, h - 2);
    }
}
