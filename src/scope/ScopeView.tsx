// Phase 4 — Scope render surface. A ref div hosts the uPlot instance, which
// is owned and driven by useScopeEngine. This component is just the shell.

import { useMemo, useRef } from "react";
import { useScopeEngine } from "./useScopeEngine";
import { useScopeStore } from "../store/scopeStore";

export function ScopeView() {
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Rebuild the chart only when the enabled-channel set changes.
    const channels = useScopeStore((s) => s.config.channels);
    const channelKey = useMemo(
        () => `${channels.v ? "v" : ""}${channels.i ? "i" : ""}${channels.w ? "w" : ""}`,
        [channels.v, channels.i, channels.w],
    );

    useScopeEngine(containerRef, channelKey);

    return (
        <div className="flex-1 relative bg-gray-900 overflow-hidden">
            <div ref={containerRef} className="absolute inset-0" />
        </div>
    );
}
