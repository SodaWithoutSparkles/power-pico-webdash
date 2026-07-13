// Phase 5 — Settings modal. A popup "window" with a category sidebar (left)
// and the active category's content (right). Connection holds connection
// settings; Display holds buffer + scale settings. Channels are controlled via
// the left toolbar, so they're omitted here.

import { useState, useEffect } from "react";
import { useScopeStore } from "../store/scopeStore";
import { Settings2, Plug, Monitor, X, Wrench } from "lucide-react";
import type { UnitMode, VoltageUnit, CurrentUnit } from "../scope/engineTypes";

function NumberField({
    label,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    value: number;
    min?: number;
    max?: number;
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
                max={max}
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

type CategoryId = "connection" | "display" | "calibration";

const CATEGORIES: { id: CategoryId; label: string; icon: typeof Plug }[] = [
    { id: "connection", label: "Connection", icon: Plug },
    { id: "display", label: "Display", icon: Monitor },
    { id: "calibration", label: "Calibration", icon: Wrench },
];

// Module-level pending tab so external callers (e.g. the Range ops
// "Calibration" button) can open settings on a specific tab.
let _pendingTab: CategoryId | null = null;
export function setSettingsTab(tab: CategoryId) {
    _pendingTab = tab;
}

export function ScopeSettings() {
    const settingsOpen = useScopeStore((s) => s.settingsOpen);
    const toggleSettings = useScopeStore((s) => s.toggleSettings);
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);
    const setBufferSec = useScopeStore((s) => s.setBufferSec);
    const setPktPerSec = useScopeStore((s) => s.setPktPerSec);
    const setVZeroOffset = useScopeStore((s) => s.setVZeroOffset);
    const setIZeroOffset = useScopeStore((s) => s.setIZeroOffset);
    const setEnergyCamp = useScopeStore((s) => s.setEnergyCamp);
    const setVUnitMode = useScopeStore((s) => s.setVUnitMode);
    const setIUnitMode = useScopeStore((s) => s.setIUnitMode);
    const setVFixedUnit = useScopeStore((s) => s.setVFixedUnit);
    const setIFixedUnit = useScopeStore((s) => s.setIFixedUnit);
    const setVYScale = useScopeStore((s) => s.setVYScale);
    const setIYScale = useScopeStore((s) => s.setIYScale);
    const setWYScale = useScopeStore((s) => s.setWYScale);
    const setCalibrationTimeSec = useScopeStore((s) => s.setCalibrationTimeSec);
    const calibrate = useScopeStore((s) => s.calibrate);

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

    // Apply a pending tab request (e.g. from the Range ops "Calibration" button).
    useEffect(() => {
        if (settingsOpen && _pendingTab) {
            setActive(_pendingTab);
            _pendingTab = null;
        }
    }, [settingsOpen]);

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
                                <div className="grid grid-cols-2 gap-3">
                                    <NumberField
                                        label="Pkt/s"
                                        value={config.pktPerSec}
                                        min={100}
                                        max={10000}
                                        step={100}
                                        onChange={(v) =>
                                            setPktPerSec(Math.min(10000, Math.max(100, Math.round(v))))
                                        }
                                    />
                                    <NumberField
                                        label="Buffer (s)"
                                        value={config.bufferSec}
                                        min={1}
                                        max={60}
                                        step={1}
                                        onChange={(v) =>
                                            setBufferSec(Math.min(60, Math.max(1, Math.round(v))))
                                        }
                                    />
                                </div>
                                <p className="text-xs text-gray-500">
                                    bufferSize = round(pktPerSec × bufferSec) ={" "}
                                    {Math.round(config.pktPerSec * config.bufferSec)} points
                                </p>

                                <div>
                                    <span className="text-xs text-gray-400">Energy unit</span>
                                    <div className="flex gap-4 mt-1">
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                name="energyCamp"
                                                checked={config.energyCamp === 'joules'}
                                                onChange={() => setEnergyCamp('joules')}
                                                className="accent-cyan-500"
                                            />
                                            Joules
                                        </label>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                name="energyCamp"
                                                checked={config.energyCamp === 'watt-hours'}
                                                onChange={() => setEnergyCamp('watt-hours')}
                                                className="accent-cyan-500"
                                            />
                                            Watt-hours
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <span className="text-xs text-gray-400">Unit mode</span>
                                    <div className="grid grid-cols-2 gap-3 mt-1">
                                        {/* Voltage */}
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-500">Voltage</span>
                                            <select
                                                value={config.vUnitMode}
                                                onChange={(e) => setVUnitMode(e.target.value as UnitMode)}
                                                className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs"
                                            >
                                                <option value="si">SI Auto</option>
                                                <option value="off">Fixed</option>
                                            </select>
                                            {config.vUnitMode === 'off' && (
                                                <select
                                                    value={config.vFixedUnit}
                                                    onChange={(e) => setVFixedUnit(e.target.value as VoltageUnit)}
                                                    className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs"
                                                >
                                                    <option value="uV">uV</option>
                                                    <option value="mV">mV</option>
                                                    <option value="V">V</option>
                                                </select>
                                            )}
                                        </div>
                                        {/* Current */}
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-500">Current</span>
                                            <select
                                                value={config.iUnitMode}
                                                onChange={(e) => setIUnitMode(e.target.value as UnitMode)}
                                                className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs"
                                            >
                                                <option value="si">SI Auto</option>
                                                <option value="off">Fixed</option>
                                                <option value="meter">Meter</option>
                                            </select>
                                            {config.iUnitMode === 'off' && (
                                                <select
                                                    value={config.iFixedUnit}
                                                    onChange={(e) => setIFixedUnit(e.target.value as CurrentUnit)}
                                                    className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs"
                                                >
                                                    <option value="uA">uA</option>
                                                    <option value="mA">mA</option>
                                                    <option value="A">A</option>
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <NumberField
                                    label="Average k (packets)"
                                    value={config.avgSize}
                                    min={1}
                                    onChange={(v) =>
                                        setConfig({ avgSize: Math.max(1, Math.round(v)) })
                                    }
                                />

                                <div>
                                    <span className="text-xs text-gray-400">Y-axis scales</span>
                                    <div className="space-y-2 mt-1">
                                        {/* Voltage Y */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-cyan-400 w-14">Voltage</span>
                                            <label className="flex items-center gap-1 text-xs">
                                                <input
                                                    type="checkbox"
                                                    checked={config.vYScale.auto}
                                                    onChange={(e) => setVYScale({ auto: e.target.checked })}
                                                    className="accent-cyan-500"
                                                />
                                                Auto
                                            </label>
                                            {!config.vYScale.auto && (
                                                <>
                                                    <input type="number" value={config.vYScale.min} step={0.1}
                                                        onChange={(e) => setVYScale({ min: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                    <span className="text-xs text-gray-500">to</span>
                                                    <input type="number" value={config.vYScale.max} step={0.1}
                                                        onChange={(e) => setVYScale({ max: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                </>
                                            )}
                                        </div>
                                        {/* Current Y */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-amber-400 w-14">Current</span>
                                            <label className="flex items-center gap-1 text-xs">
                                                <input
                                                    type="checkbox"
                                                    checked={config.iYScale.auto}
                                                    onChange={(e) => setIYScale({ auto: e.target.checked })}
                                                    className="accent-amber-500"
                                                />
                                                Auto
                                            </label>
                                            {!config.iYScale.auto && (
                                                <>
                                                    <input type="number" value={config.iYScale.min} step={0.1}
                                                        onChange={(e) => setIYScale({ min: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                    <span className="text-xs text-gray-500">to</span>
                                                    <input type="number" value={config.iYScale.max} step={0.1}
                                                        onChange={(e) => setIYScale({ max: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                </>
                                            )}
                                        </div>
                                        {/* Power Y */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-violet-400 w-14">Power</span>
                                            <label className="flex items-center gap-1 text-xs">
                                                <input
                                                    type="checkbox"
                                                    checked={config.wYScale.auto}
                                                    onChange={(e) => setWYScale({ auto: e.target.checked })}
                                                    className="accent-violet-500"
                                                />
                                                Auto
                                            </label>
                                            {!config.wYScale.auto && (
                                                <>
                                                    <input type="number" value={config.wYScale.min} step={0.1}
                                                        onChange={(e) => setWYScale({ min: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                    <span className="text-xs text-gray-500">to</span>
                                                    <input type="number" value={config.wYScale.max} step={0.1}
                                                        onChange={(e) => setWYScale({ max: parseFloat(e.target.value) || 0 })}
                                                        className="w-16 px-1 py-0.5 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs" />
                                                </>
                                            )}
                                        </div>
                                    </div>
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
                            </>
                        )}

                        {active === "calibration" && (
                            <>
                                <NumberField
                                    label="Calibration time (seconds)"
                                    value={config.calibrationTimeSec}
                                    min={1}
                                    max={30}
                                    step={1}
                                    onChange={(v) => setCalibrationTimeSec(Math.min(30, Math.max(1, Math.round(v))))}
                                />

                                <div className="space-y-3">
                                    <div>
                                        <span className="text-xs text-gray-400">Voltage calibration</span>
                                        <NumberField
                                            label="Voltage zero (V)"
                                            value={config.vZeroOffsetV}
                                            step={0.001}
                                            onChange={(v) => setVZeroOffset(v)}
                                        />
                                        <button
                                            onClick={() => calibrate('v')}
                                            className="mt-2 w-full py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
                                        >
                                            Calibrate Voltage
                                        </button>
                                    </div>
                                    <div>
                                        <span className="text-xs text-gray-400">Current calibration</span>
                                        <NumberField
                                            label="Current zero (A)"
                                            value={config.iZeroOffsetA}
                                            step={0.001}
                                            onChange={(v) => setIZeroOffset(v)}
                                        />
                                        <button
                                            onClick={() => calibrate('i')}
                                            className="mt-2 w-full py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors"
                                        >
                                            Calibrate Current
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
