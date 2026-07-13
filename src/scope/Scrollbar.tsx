import { useRef, useState, useEffect, useCallback } from "react";
import type * as React from "react";
import uPlot from "uplot";
import { useScopeStore } from "../store/scopeStore";

const BAR_HEIGHT = 12;

interface ScrollbarProps {
    uRef: React.RefObject<uPlot | null>;
}

export function Scrollbar({ uRef }: ScrollbarProps) {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [dragging, setDragging] = useState(false);
    const [thumbLeft, setThumbLeft] = useState(0);
    const [thumbWidth, setThumbWidth] = useState(100);
    const [visible, setVisible] = useState(false);

    const running = useScopeStore((s) => s.running);

    // Update thumb position/size from uPlot scales on each animation frame.
    // Runs while paused; hidden while running.
    useEffect(() => {
        if (running) {
            setVisible(false);
            return;
        }

        let raf: number;
        const loop = () => {
            const u = uRef.current;
            if (!u) {
                raf = requestAnimationFrame(loop);
                return;
            }

            const snap = useScopeStore.getState().getEngine().snapshot();
            const dataLen = snap.t.length;
            if (dataLen < 2) {
                setVisible(false);
                raf = requestAnimationFrame(loop);
                return;
            }

            const dataStart = snap.t[0];
            const dataEnd = snap.t[dataLen - 1];
            const dataRange = dataEnd - dataStart;
            if (dataRange <= 0) {
                setVisible(false);
                raf = requestAnimationFrame(loop);
                return;
            }

            const xMin = u.scales.x.min as number;
            const xMax = u.scales.x.max as number;
            const viewRange = xMax - xMin;

            const isZoomed = viewRange < dataRange * 0.95; // 5% tolerance
            setVisible(isZoomed && !running);

            if (isZoomed) {
                const leftPct = (xMin - dataStart) / dataRange;
                const widthPct = viewRange / dataRange;
                setThumbLeft(Math.max(0, Math.min(100, leftPct * 100)));
                setThumbWidth(Math.max(2, Math.min(100, widthPct * 100)));
            }

            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [uRef, running]);

    // Drag handlers
    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            const track = trackRef.current;
            if (!track) return;

            const rect = track.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const trackW = rect.width;

            // Check if click is on the thumb (with some tolerance)
            const thumbLeftPx = (thumbLeft / 100) * trackW;
            const thumbRightPx = thumbLeftPx + (thumbWidth / 100) * trackW;

            if (clickX >= thumbLeftPx - 4 && clickX <= thumbRightPx + 4) {
                // Click on thumb → start drag
                setDragging(true);
                e.preventDefault();
            } else {
                // Click on track → jump view to that position
                const u = uRef.current;
                if (!u) return;
                const snap = useScopeStore.getState().getEngine().snapshot();
                if (snap.t.length === 0) return;

                const dataStart = snap.t[0];
                const dataEnd = snap.t[snap.t.length - 1];
                const dataRange = dataEnd - dataStart;
                const pct = clickX / trackW;
                const centerT = dataStart + pct * dataRange;
                const halfRange = ((u.scales.x.max as number) - (u.scales.x.min as number)) / 2;

                let newMin = centerT - halfRange;
                let newMax = centerT + halfRange;
                if (newMin < dataStart) {
                    newMin = dataStart;
                    newMax = newMin + halfRange * 2;
                }
                if (newMax > dataEnd) {
                    newMax = dataEnd;
                    newMin = newMax - halfRange * 2;
                }

                u.setScale("x", { min: newMin, max: newMax });
            }
        },
        [uRef, thumbLeft, thumbWidth],
    );

    useEffect(() => {
        if (!dragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const track = trackRef.current;
            const u = uRef.current;
            if (!track || !u) return;

            const snap = useScopeStore.getState().getEngine().snapshot();
            if (snap.t.length === 0) return;

            const rect = track.getBoundingClientRect();
            const trackW = rect.width;
            const dataStart = snap.t[0];
            const dataEnd = snap.t[snap.t.length - 1];
            const dataRange = dataEnd - dataStart;

            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / trackW));
            const viewRange = (u.scales.x.max as number) - (u.scales.x.min as number);
            const centerT = dataStart + pct * dataRange;

            let newMin = centerT - viewRange / 2;
            let newMax = centerT + viewRange / 2;
            if (newMin < dataStart) {
                newMin = dataStart;
                newMax = newMin + viewRange;
            }
            if (newMax > dataEnd) {
                newMax = dataEnd;
                newMin = newMax - viewRange;
            }

            u.setScale("x", { min: newMin, max: newMax });
        };

        const handleMouseUp = () => {
            setDragging(false);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [dragging, uRef]);

    if (!visible) return null;

    return (
        <div
            className="absolute bottom-0 left-0 right-0 z-20"
            style={{ height: BAR_HEIGHT, background: "rgba(31,41,55,0.9)" }}
        >
            <div
                ref={trackRef}
                className="relative h-full mx-1"
                style={{ background: "#374151", borderRadius: 2 }}
                onMouseDown={handleMouseDown}
            >
                <div
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                        left: `${thumbLeft}%`,
                        width: `${thumbWidth}%`,
                        background: "rgba(34,197,94,0.4)",
                        border: "1px solid rgba(34,197,94,0.6)",
                        cursor: dragging ? "grabbing" : "grab",
                        transition: dragging ? "none" : "left 0.05s, width 0.05s",
                    }}
                />
            </div>
        </div>
    );
}
