import React, { useState } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { ChevronDown, ChevronRight, Zap, Activity, Gauge } from 'lucide-react';

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen ?? false);
    return (
        <div className="border-b border-gray-700/50">
            <button
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-200 uppercase tracking-wider"
                onClick={() => setOpen(!open)}
            >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {title}
            </button>
            {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
        </div>
    );
}

export const RightSidebar: React.FC = () => {
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);
    const connectSerial = useScopeStore((s) => s.connectSerial);
    const disconnectSerial = useScopeStore((s) => s.disconnectSerial);

    return (
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col text-gray-300 z-20 overflow-y-auto">
            {/* Connection */}
            <Section title="Connection" defaultOpen>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">Baud</label>
                    <select
                        value={config.baudRate}
                        onChange={(e) => setConfig({ baudRate: Number(e.target.value) })}
                        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    >
                        <option value={9600}>9600</option>
                        <option value={19200}>19200</option>
                        <option value={38400}>38400</option>
                        <option value={57600}>57600</option>
                        <option value={115200}>115200</option>
                    </select>
                </div>
                {status.mode === 'serial' ? (
                    <button
                        onClick={disconnectSerial}
                        className="w-full px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-medium"
                    >
                        Disconnect
                    </button>
                ) : (
                    <button
                        onClick={connectSerial}
                        className="w-full px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs font-medium"
                    >
                        Connect Serial
                    </button>
                )}
            </Section>

            {/* Buffer Settings */}
            <Section title="Buffers">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Avg size</label>
                    <input
                        type="number"
                        min={1}
                        max={1000}
                        value={config.avgSize}
                        onChange={(e) => { setConfig({ avgSize: Math.max(1, Number(e.target.value)) }); useScopeStore.getState().applyConfigToEngine(); }}
                        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Window</label>
                    <input
                        type="number"
                        min={10}
                        max={100000}
                        value={config.windowSize}
                        onChange={(e) => { setConfig({ windowSize: Math.max(10, Number(e.target.value)) }); useScopeStore.getState().applyConfigToEngine(); }}
                        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Avg mode</label>
                    <select
                        value={config.avgMode}
                        onChange={(e) => { setConfig({ avgMode: e.target.value as "simple" | "lttb" }); useScopeStore.getState().applyConfigToEngine(); }}
                        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    >
                        <option value="simple">Min-max-avg</option>
                        <option value="lttb">LTTB</option>
                    </select>
                </div>
            </Section>

            {/* Channels */}
            <Section title="Channels">
                {([
                    { id: 'v' as const, label: 'Voltage', icon: Zap, color: 'text-yellow-400' },
                    { id: 'i' as const, label: 'Current', icon: Activity, color: 'text-cyan-400' },
                    { id: 'w' as const, label: 'Power', icon: Gauge, color: 'text-fuchsia-400' },
                ]).map((ch) => (
                    <label key={ch.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.channels[ch.id]}
                            onChange={() => setConfig({
                                channels: { ...config.channels, [ch.id]: !config.channels[ch.id] }
                            })}
                            className="rounded"
                        />
                        <ch.icon size={14} className={ch.color} />
                        <span className="text-xs">{ch.label}</span>
                    </label>
                ))}
            </Section>

            {/* T+0 */}
            <Section title="T+0">
                <button
                    onClick={() => engineRef?.setTZero(status.lastTimestampUs)}
                    className="w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
                >
                    Set T=0
                </button>
                <button
                    onClick={() => engineRef?.resetTZero()}
                    className="w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
                >
                    Reset T=0
                </button>
            </Section>

            {/* Status info */}
            <Section title="Status">
                <div className="text-xs space-y-1 text-gray-400">
                    <div className="flex justify-between">
                        <span>Mode</span>
                        <span className="text-white">{status.mode}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Samples</span>
                        <span className="text-white">{status.sampleCount}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Buffer</span>
                        <span className="text-white">{(status.bufferFillPct * 100).toFixed(1)}%</span>
                    </div>
                </div>
            </Section>
        </div>
    );
};
