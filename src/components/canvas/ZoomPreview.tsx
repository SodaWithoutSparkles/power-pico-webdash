import React, { useRef, useState, useCallback } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { ZoomIn, ZoomOut } from 'lucide-react';

const BLACK_WIDTH = 250;
const MIN_GREEN_WIDTH = 10;

export const ZoomPreview: React.FC = () => {
    const engineRef = useScopeStore((s) => s.engineRef);
    const config = useScopeStore((s) => s.config);
    const status = useScopeStore((s) => s.status);

    const [cursorFrac, setCursorFrac] = useState(0);
    const isDragging = useRef(false);
    const dragStartRef = useRef({ x: 0, frac: 0 });

    const ringCap = engineRef?.ring.capacity ?? 0;
    const windowSize = config.windowSize;
    const avgSize = config.avgSize;

    // Green rect width as proportion of full buffer (raw samples covered by display window)
    const rawWindowSpan = windowSize * avgSize;
    const greenRatio = Math.min(1, rawWindowSpan / (ringCap || 1));
    const greenWidth = Math.max(MIN_GREEN_WIDTH, greenRatio * BLACK_WIDTH);
    const maxLeft = BLACK_WIDTH - greenWidth;

    // Use live cursor fraction from engine, or from drag state
    const liveFrac = engineRef?.getCursorFraction() ?? 0;
    const displayFrac = isDragging.current ? cursorFrac : liveFrac;
    const leftPos = displayFrac * maxLeft;

    /** Apply a zoom factor to avgSize, keeping windowSize at bucketCount so the graph stays full. */
    const _applyZoom = useCallback((zoomFactor: number) => {
        const state = useScopeStore.getState();
        const eng = state.engineRef;
        if (!eng) return;
        const rc = eng.ring.capacity;
        const bc = state.bucketCount;
        const newAvgSize = Math.max(1, Math.round(config.avgSize * zoomFactor));
        const maxAvg = Math.floor(rc / bc);
        const clampedAvg = Math.min(newAvgSize, Math.max(1, maxAvg || 1000));
        state.setConfig({ windowSize: Math.max(bc, config.windowSize), avgSize: clampedAvg });
        state.applyConfigToEngine();
    }, [config.avgSize, config.windowSize]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        _applyZoom(e.deltaY > 0 ? 1.15 : 1 / 1.15);
    }, [_applyZoom]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isDragging.current = true;
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        const currentFrac = eng.getCursorFraction();
        setCursorFrac(currentFrac);
        dragStartRef.current = { x: e.clientX, frac: currentFrac };

        eng.followIngest = false;

        const handleMouseMove = (ev: MouseEvent) => {
            const eng2 = useScopeStore.getState().engineRef;
            if (!isDragging.current || !eng2) return;
            const dx = ev.clientX - dragStartRef.current.x;
            const ml = BLACK_WIDTH - MIN_GREEN_WIDTH;
            const fracDelta = ml > 0 ? dx / ml : 0;
            const newFrac = Math.max(0, Math.min(1, dragStartRef.current.frac + fracDelta));
            setCursorFrac(newFrac);
            eng2.setCursorToFraction(newFrac);
        };

        const handleMouseUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const handleZoomIn = useCallback(() => {
        _applyZoom(1 / 1.3);
    }, [_applyZoom]);

    const handleZoomOut = useCallback(() => {
        _applyZoom(1.3);
    }, [_applyZoom]);

    const handleBlackClick = useCallback((e: React.MouseEvent) => {
        // Click on black background = jump cursor & snap to live
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const frac = Math.max(0, Math.min(1, x / BLACK_WIDTH));
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        eng.setCursorToFraction(frac);
        eng.followIngest = false;
        setCursorFrac(frac);
    }, []);

    const buttonHeight = 22;

    if (!engineRef) return null;

    return (
        <div className="flex items-stretch gap-0.5 select-none">
            <button
                onClick={handleZoomIn}
                className="w-4 bg-gray-800 hover:bg-gray-700 flex items-center justify-center rounded-l"
                style={{ height: buttonHeight }}
                title="Zoom in"
            >
                <ZoomIn size={9} className="text-gray-400" />
            </button>
            <div
                className="relative bg-gray-950 border border-gray-700 rounded-none cursor-pointer overflow-hidden"
                style={{ width: BLACK_WIDTH, height: buttonHeight }}
                onMouseDown={handleBlackClick}
            >
                {/* Buffer fill bar — lowest z among children, sits at bottom */}
                <div
                    className="absolute bottom-0 right-0 bg-blue-600"
                    style={{
                        width: `${Math.min(100, status.bufferFillPct * 100)}%`,
                        height: 3,
                        zIndex: 1,
                    }}
                />
                {/* Green viewport rect — sits above buffer bar */}
                <div
                    className="absolute top-0 h-full bg-green-500/30 border border-green-500 rounded-sm"
                    style={{
                        width: greenWidth,
                        left: leftPos,
                        zIndex: 2,
                        cursor: isDragging.current ? 'grabbing' : 'ew-resize',
                    }}
                    onWheel={handleWheel}
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
                />
            </div>
            <button
                onClick={handleZoomOut}
                className="w-4 bg-gray-800 hover:bg-gray-700 flex items-center justify-center rounded-r"
                style={{ height: buttonHeight }}
                title="Zoom out"
            >
                <ZoomOut size={9} className="text-gray-400" />
            </button>
        </div>
    );
};
