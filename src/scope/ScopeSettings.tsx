// Phase 5 — Right settings panel. Collapsible. Baud, avg k, window N,
// channel checkboxes, vertical scale, horizontal zoom. Reads/writes config.

import { useState } from "react";
import { useScopeStore } from "../store/scopeStore";
import { Settings2, ChevronRight, ChevronLeft } from "lucide-react";

function NumberField({
    label,
    value,
    min,
    step,
    onChange,
}: {
    label: string;
    value: number;
    min?: number;
    step?: number;
    onChange: (v: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1 text-xs text-gray-400">
            <span>{label}</span>
            <input
                type="number"
                value={value}
                min={min}
                step={step}
                onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (!Number.isNaN(n)) onChange(n);
                }}
                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-cyan-500 focus:outline-none text-gray-100"
            />
        </label>
    );
}

export function ScopeSettings() {
    const [collapsed, setCollapsed] = useState(false);
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);

    if (collapsed) {
        return (
            <div className="w-10 bg-gray-800 border-l border-gray-700 flex flex-col items-center py-2">
                <button
                    onClick={() => setCollapsed(false)}
                    className="p-2 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    title="Expand settings"
                >
                    <ChevronLeft size={18} />
                </button>
                <Settings2 size={18} className="text-gray-500 mt-2" />
            </div>
        );
    }

    return (
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col text-gray-300 z-20">
            <div className="bg-gray-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-2">
                    <Settings2 size={12} /> Settings
                </span>
                <button
                    onClick={() => setCollapsed(true)}
                    className="text-gray-400 hover:text-gray-200"
                    title="Collapse"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <NumberField
                    label="Baud rate"
                    value={config.baudRate}
                    min={1}
                    step={100}
                    onChange={(v) => setConfig({ baudRate: Math.round(v) })}
                />

                <div className="grid grid-cols-2 gap-3">
                    <NumberField
                        label="Avg k"
                        value={config.avgSize}
                        min={1}
                        onChange={(v) => setConfig({ avgSize: Math.max(1, Math.round(v)) })}
                    />
                    <NumberField
                        label="Window N"
                        value={config.windowSize}
                        min={1}
                        onChange={(v) => setConfig({ windowSize: Math.max(1, Math.round(v)) })}
                    />
                </div>

                <div>
                    <span className="text-xs text-gray-400">Channels</span>
                    <div className="mt-1 space-y-1">
                        {(["v", "i", "w"] as const).map((k) => (
                            <label key={k} className="flex items-center gap-2 text-sm capitalize">
                                <input
                                    type="checkbox"
                                    checked={config.channels[k]}
                                    onChange={(e) =>
                                        setConfig({
                                            channels: { ...config.channels, [k]: e.target.checked },
                                        })
                                    }
                                    className="accent-cyan-500"
                                />
                                {k === "v" ? "Voltage" : k === "i" ? "Current" : "Power"}
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <span className="text-xs text-gray-400">Vertical scale</span>
                    <label className="flex items-center gap-2 text-sm mt-1">
                        <input
                            type="checkbox"
                            checked={config.vScale.auto}
                            onChange={(e) =>
                                setConfig({ vScale: { ...config.vScale, auto: e.target.checked } })
                            }
                            className="accent-cyan-500"
                        />
                        Auto
                    </label>
                    {!config.vScale.auto && (
                        <div className="grid grid-cols-2 gap-3 mt-2">
                            <NumberField
                                label="Min"
                                value={config.vScale.min}
                                step={0.1}
                                onChange={(v) => setConfig({ vScale: { ...config.vScale, min: v } })}
                            />
                            <NumberField
                                label="Max"
                                value={config.vScale.max}
                                step={0.1}
                                onChange={(v) => setConfig({ vScale: { ...config.vScale, max: v } })}
                            />
                        </div>
                    )}
                </div>

                <NumberField
                    label="Horizontal zoom (s, 0 = fit)"
                    value={config.hZoomSec}
                    min={0}
                    step={0.5}
                    onChange={(v) => setConfig({ hZoomSec: Math.max(0, v) })}
                />
            </div>
        </div>
    );
}
