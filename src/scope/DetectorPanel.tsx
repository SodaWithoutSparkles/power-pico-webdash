import { useState, useEffect } from "react";
import { useScopeStore } from "../store/scopeStore";
import { PopupPanel } from "./PopupPanel";
import { Activity, Download } from "lucide-react";
import type { DetectorDirection, DetectorChannelConfig } from "./engineTypes";

// Simple number field (inline — don't create a new component file)
function NumField({ label, value, min, max, step, onChange }: {
    label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1 text-xs text-gray-400">
            <span>{label}</span>
            <input type="number" value={value} min={min} max={max} step={step}
                onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(n); }}
                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-cyan-500 focus:outline-none text-gray-100" />
        </label>
    );
}

interface DetectorPanelProps {
    open: boolean;
    onClose: () => void;
}

export function DetectorPanel({ open, onClose }: DetectorPanelProps) {
    const detectorVConfig = useScopeStore((s) => s.detectorVConfig);
    const detectorIConfig = useScopeStore((s) => s.detectorIConfig);
    const setDetectorConfig = useScopeStore((s) => s.setDetectorConfig);
    const detectorEvents = useScopeStore((s) => s.detectorEvents);
    const syncDetectorEvents = useScopeStore((s) => s.syncDetectorEvents);
    const clearDetectorEvents = useScopeStore((s) => s.clearDetectorEvents);
    const [tab, setTab] = useState<"config" | "events">("config");

    // Sync events when panel opens or tab switches to events
    useEffect(() => {
        if (open && tab === "events") syncDetectorEvents();
        if (!open) return;
        const interval = setInterval(() => {
            if (tab === "events") syncDetectorEvents();
        }, 500);
        return () => clearInterval(interval);
    }, [open, tab, syncDetectorEvents]);

    // Config section for one channel
    const renderChannelConfig = (channel: 'v' | 'i', config: DetectorChannelConfig) => (
        <div className="space-y-2 p-3 border border-gray-700 rounded">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-300">
                    {channel === 'v' ? 'Voltage' : 'Current'}
                </span>
                <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={config.enabled}
                        onChange={(e) => setDetectorConfig(channel, { enabled: e.target.checked })}
                        className="accent-cyan-500" />
                    Enabled
                </label>
            </div>
            {config.enabled && (
                <div className="grid grid-cols-2 gap-2">
                    <NumField label={`Threshold (${channel === 'v' ? 'V' : 'A'})`} value={config.threshold}
                        step={0.01} onChange={(v) => setDetectorConfig(channel, { threshold: v })} />
                    <NumField label="Hysteresis" value={config.hysteresis}
                        step={0.001} onChange={(v) => setDetectorConfig(channel, { hysteresis: v })} />
                    <NumField label="Debounce (ms)" value={config.debounceMs} min={0} step={10}
                        onChange={(v) => setDetectorConfig(channel, { debounceMs: Math.max(0, v) })} />
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-gray-400">Direction</span>
                        <select value={config.direction}
                            onChange={(e) => setDetectorConfig(channel, { direction: e.target.value as DetectorDirection })}
                            className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-100 text-xs">
                            <option value="positive">Positive</option>
                            <option value="negative">Negative</option>
                            <option value="both">Both</option>
                        </select>
                    </div>
                </div>
            )}
        </div>
    );

    // Events list
    const renderEvents = () => {
        const reversed = [...detectorEvents].reverse(); // newest first
        if (reversed.length === 0) {
            return <div className="text-xs text-gray-500 p-4">No events detected.</div>;
        }
        return (
            <div className="space-y-1">
                {reversed.map((evt) => (
                    <div key={evt.id} className="flex items-center gap-3 text-xs font-mono p-1 hover:bg-gray-700/50 rounded">
                        <span className={evt.channel === 'v' ? 'text-cyan-400' : 'text-amber-400'}>{evt.channel.toUpperCase()}</span>
                        <span className={evt.direction === 'rising' ? 'text-green-400' : 'text-red-400'}>
                            {evt.direction === 'rising' ? '↑' : '↓'}
                        </span>
                        <span className="text-gray-300">{(evt.value).toFixed(4)}</span>
                        <span className="text-gray-500">@ {(evt.timestampUs / 1_000_000).toFixed(4)}s</span>
                        <span className="text-gray-600">th={evt.threshold.toFixed(3)}</span>
                    </div>
                ))}
            </div>
        );
    };

    // Export events as CSV
    const exportEventsCSV = () => {
        const rows = ["id,channel,direction,value,threshold,timestamp_us"];
        for (const e of detectorEvents) {
            rows.push(`${e.id},${e.channel},${e.direction},${e.value},${e.threshold},${e.timestampUs}`);
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `detector_events_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <PopupPanel open={open} onClose={onClose} title="Detector" icon={<Activity size={16} />}>
            <div className="flex h-full">
                {/* Sidebar tabs */}
                <nav className="w-24 shrink-0 bg-gray-900 border-r border-gray-700 p-2 space-y-1">
                    {(["config", "events"] as const).map((t) => (
                        <button key={t} onClick={() => setTab(t)}
                            className={`w-full py-2 rounded text-xs capitalize transition-colors ${tab === t ? "bg-gray-700 text-cyan-400" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}`}>
                            {t}
                        </button>
                    ))}
                </nav>
                {/* Content */}
                <div className="flex-1 p-4 overflow-y-auto">
                    {tab === "config" && (
                        <div className="space-y-4">
                            {renderChannelConfig('v', detectorVConfig)}
                            {renderChannelConfig('i', detectorIConfig)}
                        </div>
                    )}
                    {tab === "events" && (
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-sm font-semibold text-gray-300">
                                    Events ({detectorEvents.length})
                                </span>
                                <div className="flex gap-2">
                                    <button onClick={exportEventsCSV}
                                        className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300"
                                        disabled={detectorEvents.length === 0}>
                                        <Download size={12} /> Export CSV
                                    </button>
                                    <button onClick={clearDetectorEvents}
                                        className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-300"
                                        disabled={detectorEvents.length === 0}>
                                        Clear
                                    </button>
                                </div>
                            </div>
                            {renderEvents()}
                        </div>
                    )}
                </div>
            </div>
        </PopupPanel>
    );
}
