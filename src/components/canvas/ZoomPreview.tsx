import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { ZoomIn, ZoomOut, Lock, LockOpen } from 'lucide-react';
import { computeGreenWidth, cursorToLeft, leftToCursor } from '../../scope/ui/scopeCursorController';

const BLACK_WIDTH = 250;
const CTRL_SCROLL_ZOOM_FACTOR = 1.15;
const SIDE_BUTTON_ZOOM_FACTOR = 1.3;
const SCROLL_CURSOR_MOVE_FACTOR = 0.02;

export const ZoomPreview: React.FC = () => {
    const engineRef = useScopeStore(s => s.engineRef);
    const bucketCount = useScopeStore(s => s.bucketCount);

    const isDragging = useRef(false);
    const dragStartRef = useRef({ x: 0, left: 0 });
    const [dragCursor, setDragCursor] = useState(-1);

    const startDrag = useCallback((clientX: number) => {
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        eng.followIngest = false;
        const cur = eng.getCursorFraction();
        setDragCursor(cur);
        isDragging.current = true;

        const bc = useScopeStore.getState().bucketCount;
        const gw = computeGreenWidth(
            bc,
            eng.avgWindowSize,
            eng.ring.capacity,
            BLACK_WIDTH,
        );
        dragStartRef.current = { x: clientX, left: cursorToLeft(cur, BLACK_WIDTH, gw) };

        const handleMouseMove = (ev: MouseEvent) => {
            if (!isDragging.current) return;
            const dx = ev.clientX - dragStartRef.current.x;
            const s = useScopeStore.getState();
            const e2 = s.engineRef;
            if (!e2) return;
            const gw2 = computeGreenWidth(
                s.bucketCount,
                e2.avgWindowSize,
                e2.ring.capacity,
                BLACK_WIDTH,
            );
            const ml = BLACK_WIDTH - gw2;
            const newLeft = Math.max(0, Math.min(ml, dragStartRef.current.left + dx));
            const newCursor = leftToCursor(newLeft, BLACK_WIDTH, gw2);
            setDragCursor(newCursor);
            e2.setCursorToFraction(newCursor);
        };

        const handleMouseUp = () => {
            isDragging.current = false;
            setDragCursor(-1);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const handleGreenMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(e.clientX);
    }, [startDrag]);

    const handleBlackMouseDown = useCallback((e: React.MouseEvent) => {
        if (isDragging.current) return;
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const s = useScopeStore.getState();
        const gw = computeGreenWidth(
            s.bucketCount,
            eng.avgWindowSize,
            eng.ring.capacity,
            BLACK_WIDTH,
        );
        const ml = BLACK_WIDTH - gw;
        const newLeft = Math.max(0, Math.min(ml, clickX - gw));
        const newCursor = leftToCursor(newLeft, BLACK_WIDTH, gw);
        eng.setCursorToFraction(newCursor);
        eng.followIngest = false;
    }, []);

    const applyZoom = useCallback((factor: number) => {
        const st = useScopeStore.getState();
        const cfg = st.config;
        const newAvgSize = Math.max(1, Math.round(cfg.avgSize * factor));
        st.setConfig({ avgSize: newAvgSize });
        st.applyConfigToEngine();
    }, []);

    const handleZoomIn = useCallback(() => applyZoom(1 / SIDE_BUTTON_ZOOM_FACTOR), [applyZoom]);
    const handleZoomOut = useCallback(() => applyZoom(SIDE_BUTTON_ZOOM_FACTOR), [applyZoom]);

    const moveCursor = useCallback((dir: number) => {
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        eng.followIngest = false;
        const frac = eng.getCursorFraction();
        eng.setCursorToFraction(frac + dir * SCROLL_CURSOR_MOVE_FACTOR);
    }, []);

    const toggleLock = useCallback(() => {
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        eng.cursorLocked = !eng.cursorLocked;
    }, []);

    const handleDoubleClick = useCallback(() => {
        const eng = useScopeStore.getState().engineRef;
        if (!eng) return;
        eng.followIngest = true;
    }, []);

    // ── Wheel handler on black bar ──
    const blackRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = blackRef.current;
        if (!el) return;
        const handler = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                applyZoom(e.deltaY > 0 ? CTRL_SCROLL_ZOOM_FACTOR : 1 / CTRL_SCROLL_ZOOM_FACTOR);
            } else {
                moveCursor(e.deltaY > 0 ? SCROLL_CURSOR_MOVE_FACTOR : -SCROLL_CURSOR_MOVE_FACTOR);
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [applyZoom, moveCursor]);

    // ── Side button (mouse back/forward) → zoom in/out ──
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (e.button === 3) { applyZoom(1 / SIDE_BUTTON_ZOOM_FACTOR); }  // back → zoom in
            if (e.button === 4) { applyZoom(SIDE_BUTTON_ZOOM_FACTOR); }       // forward → zoom out
        };
        window.addEventListener('mouseup', handler);
        return () => window.removeEventListener('mouseup', handler);
    }, [applyZoom]);

    // ── Early return after all hooks ──
    if (!engineRef) return null;

    const followIngest = engineRef.followIngest;
    const locked = engineRef.cursorLocked;
    const rawFill = engineRef.ring.fillPct;
    const greenWidth = computeGreenWidth(
        bucketCount,
        engineRef.avgWindowSize,
        engineRef.ring.capacity,
        BLACK_WIDTH,
    );
    const effectiveCursor = dragCursor >= 0 ? dragCursor : engineRef.getCursorFraction();
    const leftPos = cursorToLeft(effectiveCursor, BLACK_WIDTH, greenWidth);
    const buttonHeight = 22;

    return (
        <div className="flex items-stretch gap-0.5 select-none">
            <button onClick={handleZoomIn} className="w-4 bg-gray-800 hover:bg-gray-700 flex items-center justify-center rounded-l"
                style={{ height: buttonHeight }} title="Zoom in">
                <ZoomIn size={9} className="text-gray-400" />
            </button>
            <div
                className="relative bg-gray-950 rounded-none overflow-hidden"
                style={{
                    width: BLACK_WIDTH,
                    height: buttonHeight,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: followIngest ? '#374151' : '#ef4444',
                    cursor: followIngest ? 'pointer' : 'default',
                }}
                ref={blackRef}
                onMouseDown={handleBlackMouseDown}
                onDoubleClick={handleDoubleClick}
            >
                {/* Buffer fill bar — right-aligned, grows left as data fills in */}
                <div
                    className="absolute bottom-0 right-0 bg-blue-600"
                    style={{
                        width: `${Math.min(100, rawFill * 100)}%`,
                        height: 3,
                        zIndex: 1,
                    }}
                />
                {/* Green viewport rect — sits above buffer bar */}
                <div
                    className="absolute top-0 h-full rounded-sm"
                    style={{
                        width: greenWidth,
                        left: leftPos,
                        zIndex: 2,
                        backgroundColor: 'rgba(34,197,94,0.3)',
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: '#22c55e',
                        cursor: 'ew-resize',
                    }}
                    onMouseDown={handleGreenMouseDown}
                />
            </div>
            <button onClick={handleZoomOut} className="w-4 bg-gray-800 hover:bg-gray-700 flex items-center justify-center rounded-r"
                style={{ height: buttonHeight }} title="Zoom out">
                <ZoomOut size={9} className="text-gray-400" />
            </button>
            <button
                onClick={toggleLock}
                className={`w-4 flex items-center justify-center ${locked ? 'bg-gray-700' : 'bg-gray-800'} hover:bg-gray-600 rounded`}
                style={{ height: buttonHeight }}
                title={locked ? 'Unlock cursor from trace' : 'Lock cursor to trace'}
            >
                {locked
                    ? <Lock size={9} className="text-gray-300" />
                    : <LockOpen size={9} className="text-gray-500" />
                }
            </button>
        </div>
    );
};
