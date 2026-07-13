// Phase 4 — Scope render surface. A ref div hosts the uPlot instance, which
// is owned and driven by useScopeEngine. This component is just the shell.

import { useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import { useScopeEngine } from "./useScopeEngine";
import { useScopeStore } from "../store/scopeStore";
import { Scrollbar } from "./Scrollbar";
import { ZoomedPreview } from "./ZoomedPreview";
import { DetectorPanel } from "./DetectorPanel";
import { exportRegionCSV } from "./csvExport";
import { setSettingsTab } from "./ScopeSettings";
import { EllipsisVertical, Download, Activity, Wrench, Eraser } from "lucide-react";

export function ScopeView() {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const uRef = useRef<uPlot | null>(null);
    const [detectorOpen, setDetectorOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    // Rebuild the chart only when the enabled-channel set changes.
    const channels = useScopeStore((s) => s.config.channels);
    const region = useScopeStore((s) => s.region);
    const clear = useScopeStore((s) => s.clear);
    const clearRegion = useScopeStore((s) => s.clearRegion);
    const toggleSettings = useScopeStore((s) => s.toggleSettings);
    const channelKey = useMemo(
        () => `${channels.v ? "v" : ""}${channels.i ? "i" : ""}${channels.w ? "w" : ""}`,
        [channels.v, channels.i, channels.w],
    );

    useScopeEngine(containerRef, uRef, channelKey);

    return (
        <div className="flex-1 relative bg-gray-900 overflow-hidden">
            <div ref={containerRef} className="absolute inset-0" />
            <ZoomedPreview uRef={uRef} />
            <Scrollbar uRef={uRef} />

            {/* Range operations — top-right corner */}
            <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="absolute top-2 right-2 z-20 p-1.5 rounded bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border border-gray-700/50"
                title="Range operations"
            >
                <EllipsisVertical size={18} />
            </button>

            {menuOpen && (
                <div
                    className="absolute top-10 right-2 z-30 bg-gray-800 border border-gray-700 rounded shadow-xl py-1 min-w-[160px]"
                    onClick={() => setMenuOpen(false)}
                >
                    <button
                        onClick={() => {
                            const s = useScopeStore.getState();
                            if (s.region)
                                exportRegionCSV(
                                    s.getEngine(),
                                    s.region.tStartUs,
                                    s.region.tEndUs,
                                    s.config.vZeroOffsetV,
                                    s.config.iZeroOffsetA,
                                );
                        }}
                        disabled={!region}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Download size={14} /> Export CSV
                    </button>
                    <button
                        onClick={() => setDetectorOpen(true)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                    >
                        <Activity size={14} /> Detector
                    </button>
                    <button
                        onClick={() => {
                            setSettingsTab("calibration");
                            toggleSettings();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                    >
                        <Wrench size={14} /> Calibration
                    </button>
                    <hr className="border-gray-700 my-1" />
                    <button
                        onClick={() => {
                            clear();
                            clearRegion();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                    >
                        <Eraser size={14} /> Clear
                    </button>
                </div>
            )}

            <DetectorPanel open={detectorOpen} onClose={() => setDetectorOpen(false)} />
        </div>
    );
}
