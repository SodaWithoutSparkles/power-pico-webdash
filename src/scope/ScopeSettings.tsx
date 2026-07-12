// Phase 5 — Settings modal. A popup "window" with a category sidebar (left)
// and the active category's content (right). Connection holds connection
// settings; Display holds buffer + scale settings. Channels are controlled via
// the left toolbar, so they're omitted here.

import { useState, useEffect } from "react";
import { useScopeStore } from "../store/scopeStore";
import { Settings2, Plug, Monitor, X } from "lucide-react";

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

type CategoryId = "connection" | "display";

const CATEGORIES: { id: CategoryId; label: string; icon: typeof Plug }[] = [
    { id: "connection", label: "Connection", icon: Plug },
    { id: "display", label: "Display", icon: Monitor },
];

export function ScopeSettings() {
    const settingsOpen = useScopeStore((s) => s.settingsOpen);
    const toggleSettings = useScopeStore((s) => s.toggleSettings);
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);

    const [active, setActive] = useState<CategoryId>("connection");

    // Close on Escape.
    useEffect(() => {
        if (!settingsOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") toggleSettings();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [settingsOpen, toggleSettings]);

    if (!settingsOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={toggleSettings}
        >
            <div
                className="w-[28rem] max-h-[80vh] bg-gray-800 border border-gray-700 rounded-lg shadow-2xl flex flex-col text-gray-300 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bg-gray-900 px-4 py-2 text-sm font-semibold uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Settings2 size={14} /> Settings
                    </span>
                    <button
                        onClick={toggleSettings}
                        className="text-gray-400 hover:text-gray-200"
                        title="Close settings"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Category sidebar */}
                    <nav className="w-28 shrink-0 bg-gray-900 border-r border-gray-700 p-2 space-y-1">
                        {CATEGORIES.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setActive(id)}
                                className={`w-full flex flex-col items-center gap-1 py-2 rounded text-xs transition-colors ${active === id
                                    ? "bg-gray-700 text-cyan-400"
                                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                                    }`}
                            >
                                <Icon size={18} />
                                {label}
                            </button>
                        ))}
                    </nav>

                    {/* Category content */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {active === "connection" && (
                            <NumberField
                                label="Baud rate"
                                value={config.baudRate}
                                min={1}
                                step={100}
                                onChange={(v) => setConfig({ baudRate: Math.round(v) })}
                            />
                        )}

                        {active === "display" && (
                            <>
                                <NumberField
                                    label="Buffer N (samples)"
                                    value={config.bufferSize}
                                    min={1}
                                    onChange={(v) =>
                                        setConfig({ bufferSize: Math.max(1, Math.round(v)) })
                                    }
                                />

                                <NumberField
                                    label="Average k (packets)"
                                    value={config.avgSize}
                                    min={1}
                                    onChange={(v) =>
                                        setConfig({ avgSize: Math.max(1, Math.round(v)) })
                                    }
                                />

                                <div>
                                    <span className="text-xs text-gray-400">Vertical scale</span>
                                    <label className="flex items-center gap-2 text-sm mt-1">
                                        <input
                                            type="checkbox"
                                            checked={config.vScale.auto}
                                            onChange={(e) =>
                                                setConfig({
                                                    vScale: { ...config.vScale, auto: e.target.checked },
                                                })
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
                                                onChange={(v) =>
                                                    setConfig({ vScale: { ...config.vScale, min: v } })
                                                }
                                            />
                                            <NumberField
                                                label="Max"
                                                value={config.vScale.max}
                                                step={0.1}
                                                onChange={(v) =>
                                                    setConfig({ vScale: { ...config.vScale, max: v } })
                                                }
                                            />
                                        </div>
                                    )}
                                </div>

                                <NumberField
                                    label="Horizontal zoom (s, 0 = fit buffer)"
                                    value={config.hZoomSec}
                                    min={0}
                                    step={0.5}
                                    onChange={(v) => setConfig({ hZoomSec: Math.max(0, v) })}
                                />

                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={config.followLatest}
                                        onChange={(e) =>
                                            setConfig({ followLatest: e.target.checked })
                                        }
                                        className="accent-cyan-500"
                                    />
                                    Follow latest (scroll)
                                </label>

                                <NumberField
                                    label="Vertical zoom (×, 1 = fit)"
                                    value={config.vZoom}
                                    min={1}
                                    step={0.1}
                                    onChange={(v) => setConfig({ vZoom: Math.max(1, v) })}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
