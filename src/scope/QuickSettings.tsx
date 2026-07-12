// Phase 5 — Quick settings. Sits in the right panel (replacing the old
// settings panel). Controls the two visual scaling knobs: vertical zoom and
// horizontal zoom. Buffer size / channels live elsewhere.

import { useScopeStore } from "../store/scopeStore";
import { ZoomIn, ZoomOut, MoveHorizontal } from "lucide-react";

export function QuickSettings() {
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);

    const hZoom = config.hZoomSec;
    const vZoom = config.vZoom;

    return (
        <div className="bg-gray-800 border-l border-gray-700 text-gray-300">
            <div className="bg-gray-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <MoveHorizontal size={12} /> Quick Settings
            </div>

            <div className="p-3 space-y-3">
                {/* Horizontal zoom */}
                <div>
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Horizontal zoom</span>
                        <span className="font-mono text-gray-200">
                            {hZoom === 0 ? "fit" : `${hZoom.toFixed(1)} s`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                            title="Zoom out (wider window)"
                            onClick={() =>
                                setConfig({ hZoomSec: Math.max(0, +(hZoom - 1).toFixed(1)) })
                            }
                        >
                            <ZoomOut size={14} />
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={60}
                            step={0.5}
                            value={hZoom}
                            onChange={(e) => setConfig({ hZoomSec: parseFloat(e.target.value) })}
                            className="flex-1 accent-cyan-500"
                        />
                        <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                            title="Zoom in (narrower window)"
                            onClick={() =>
                                setConfig({ hZoomSec: Math.min(60, +(hZoom + 1).toFixed(1)) })
                            }
                        >
                            <ZoomIn size={14} />
                        </button>
                    </div>
                </div>

                {/* Vertical zoom */}
                <div>
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Vertical zoom</span>
                        <span className="font-mono text-gray-200">{vZoom.toFixed(1)}×</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                            title="Zoom out"
                            onClick={() =>
                                setConfig({ vZoom: Math.max(1, +(vZoom - 0.25).toFixed(2)) })
                            }
                        >
                            <ZoomOut size={14} />
                        </button>
                        <input
                            type="range"
                            min={1}
                            max={10}
                            step={0.25}
                            value={vZoom}
                            onChange={(e) => setConfig({ vZoom: parseFloat(e.target.value) })}
                            className="flex-1 accent-cyan-500"
                        />
                        <button
                            className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                            title="Zoom in"
                            onClick={() =>
                                setConfig({ vZoom: Math.min(10, +(vZoom + 0.25).toFixed(2)) })
                            }
                        >
                            <ZoomIn size={14} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
