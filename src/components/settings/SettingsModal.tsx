import React, { useState, useRef, useCallback } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { X, Zap, Activity, Gauge, Database, Monitor, Sliders } from 'lucide-react';
import clsx from 'clsx';
import { Toggle } from '../common/Toggle';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';

// ── Helpers ──

function toMs(avgSize: number, rate: number): number {
    return rate > 0 ? (avgSize / rate) * 1000 : 0;
}
function toSamples(ms: number, rate: number): number {
    return Math.max(1, Math.round((ms / 1000) * rate));
}
function displaySeconds(windowSize: number, avgSize: number, rate: number): number {
    return rate > 0 ? (windowSize * avgSize) / rate : 0;
}
function displayBuckets(sec: number, avgMs: number): number {
    return avgMs > 0 ? Math.max(1, Math.round((sec * 1000) / avgMs)) : 1;
}
function ringSeconds(capacity: number, rate: number): number {
    return rate > 0 ? capacity / rate : 0;
}
function ringSamples(sec: number, rate: number): number {
    return Math.max(1, Math.round(sec * rate));
}

// ── Blur-validated number input ──

interface BlurInputProps {
    /** Current live value (from store). */
    value: number;
    /** Called on blur with the validated number. Parents update store. */
    onCommit: (v: number) => void;
    min: number;
    max: number;
    step?: number;
    className?: string;
    /** Format the display value (e.g. to fixed decimals). */
    display?: (v: number) => string;
    /** Parse the raw text back to a number. */
    parse?: (s: string) => number;
    /** Extra validation after parse+clamp. Return clamped value or throw. */
    extraValidate?: (v: number) => number;
}

const BlurInput: React.FC<BlurInputProps> = ({
    value, onCommit, min, max, step, className, display, parse, extraValidate,
}) => {
    const [text, setText] = useState(() => (display ? display(value) : String(value)));
    const [focused, setFocused] = useState(false);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    const handleBlur = useCallback(() => {
        setFocused(false);
        const raw = parse ? parse(text) : Number(text);
        if (isNaN(raw)) { setText(display ? display(value) : String(value)); return; }
        let clamped = Math.max(min, Math.min(max, raw));
        if (extraValidate) clamped = extraValidate(clamped);
        commitRef.current(clamped);
        // After commit, parent store updates; display the committed value
        setText(display ? display(clamped) : String(clamped));
    }, [text, min, max, display, parse, extraValidate, value]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
    }, []);

    // Sync from store when not focused (in case another input changes the underlying value)
    if (!focused && text !== (display ? display(value) : String(value))) {
        setText(display ? display(value) : String(value));
    }

    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            step={step}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            className={className ?? "w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 text-right font-mono focus:outline-none focus:border-blue-500"}
        />
    );
};

// ── Category definitions ──

interface Category {
    id: string;
    label: string;
    icon: React.FC<{ size?: number; className?: string }>;
}

const CATEGORIES: Category[] = [
    { id: 'buffer', label: 'Buffer', icon: Database },
    { id: 'channels', label: 'Channels', icon: Sliders },
    { id: 'display', label: 'Display', icon: Monitor },
];

// ── Panel components ──

const BufferPanel: React.FC = () => {
    const config = useScopeStore((s) => s.config);

    const rate = config.nominalSampleRate;
    const avgMs = toMs(config.avgSize, rate);
    const dispSec = displaySeconds(config.windowSize, config.avgSize, rate);
    const ringSec = ringSeconds(config.ringCapacity, rate);

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Sample Rate" description="Expected sample rate from the device. Used to show time-based values below.">
                <SettingsEntry label="Expected rate" description="Raw samples per second from device. Used to estimate observation timing.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={rate}
                            onCommit={(v) => {
                                useScopeStore.getState().setConfig({ nominalSampleRate: Math.max(1, v) });
                            }}
                            min={1}
                            max={10_000_000}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">sps</span>
                    </div>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Packet Smoothing" description="Average raw ADC samples within each packet into single observations to reduce noise.">
                <SettingsEntry label="Expected per packet" description="Expected raw samples per device packet. Used to detect undersized packets.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.expectedSamplesPerPacket}
                            onCommit={(v) => {
                                useScopeStore.getState().setConfig({ expectedSamplesPerPacket: Math.max(1, Math.round(v)) });
                                const eng = useScopeStore.getState().engineRef;
                                if (eng) eng.expectedSamplesPerPacket = Math.max(1, Math.round(v));
                            }}
                            min={1}
                            max={10000}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">samples</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Smoothing group" description="How many raw samples to average into one observation. -1 = entire packet.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.packetSmoothing}
                            onCommit={(v) => {
                                const val = v === -1 ? -1 : Math.max(1, Math.round(v));
                                useScopeStore.getState().setConfig({ packetSmoothing: val });
                                const eng = useScopeStore.getState().engineRef;
                                if (eng) eng.packetSmoothing = val;
                            }}
                            min={-1}
                            max={10000}
                            display={(v) => v === -1 ? '-1' : String(v)}
                            parse={(s) => s.trim() === '-1' ? -1 : parseInt(s, 10)}
                            extraValidate={(v) => v === -1 ? -1 : Math.max(1, Math.round(v))}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">samples</span>
                    </div>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Averaging" description="Controls how incoming observations are grouped into display buckets.">
                <SettingsEntry label="Bucket width" description="Time span per averaged bucket.">
                    <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1.5">
                            <BlurInput
                                value={avgMs}
                                onCommit={(ms) => {
                                    const newAvg = toSamples(ms, rate);
                                    const capped = Math.min(newAvg, Math.floor(config.ringCapacity / config.windowSize));
                                    const clamped = Math.max(1, capped);
                                    useScopeStore.getState().setConfig({ avgSize: clamped });
                                    useScopeStore.getState().applyConfigToEngine();
                                }}
                                min={0.001}
                                max={10000}
                                step={0.1}
                                display={(v) => v.toFixed(2)}
                                parse={(s) => parseFloat(s)}
                                extraValidate={(v) => Math.max(0.001, v)}
                            />
                            <span className="text-[11px] text-gray-500 font-mono">ms</span>
                        </div>
                        <span className="text-[10px] text-gray-500">{config.avgSize} observations</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Avg mode" description="LTTB preserves shape with fewer points; simple shows min/max envelopes.">
                    <select
                        value={config.avgMode}
                        onChange={(e) => {
                            useScopeStore.getState().setConfig({ avgMode: e.target.value as 'simple' | 'lttb' });
                            useScopeStore.getState().applyConfigToEngine();
                        }}
                        className="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    >
                        <option value="simple">Min-max-avg</option>
                        <option value="lttb">LTTB</option>
                    </select>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Display Range" description="How much time is visible on the scope graph.">
                <SettingsEntry label="Time span" description="Total visible time window.">
                    <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1.5">
                            <BlurInput
                                value={dispSec}
                                onCommit={(sec) => {
                                    const newBuckets = displayBuckets(sec, avgMs);
                                    // Ensure constraints: newBuckets * avgSize <= ringCapacity
                                    const maxBuckets = Math.floor(config.ringCapacity / config.avgSize);
                                    const clamped = Math.max(1, Math.min(newBuckets, maxBuckets));
                                    useScopeStore.getState().setConfig({ windowSize: clamped });
                                    useScopeStore.getState().applyConfigToEngine();
                                }}
                                min={0.001}
                                max={100000}
                                step={0.1}
                                display={(v) => v.toFixed(2)}
                                parse={(s) => parseFloat(s)}
                                extraValidate={(v) => Math.max(0.001, v)}
                            />
                            <span className="text-[11px] text-gray-500 font-mono">s</span>
                        </div>
                        <span className="text-[10px] text-gray-500">{config.windowSize} observations</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Ring history" description="Total raw sample history. Applies after reconnect.">
                    <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1.5">
                            <BlurInput
                                value={ringSec}
                                onCommit={(sec) => {
                                    const newCap = ringSamples(sec, rate);
                                    const minCap = config.avgSize * config.windowSize;
                                    const clamped = Math.max(minCap, Math.min(10_000_000, newCap));
                                    useScopeStore.getState().setConfig({ ringCapacity: clamped });
                                }}
                                min={0.01}
                                max={100000}
                                step={1}
                                display={(v) => v.toFixed(1)}
                                parse={(s) => parseFloat(s)}
                                extraValidate={(v) => Math.max(0.01, v)}
                            />
                            <span className="text-[11px] text-gray-500 font-mono">s</span>
                        </div>
                        <span className="text-[10px] text-gray-500">{config.ringCapacity.toLocaleString()} slots</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Used capacity" description="= avgSize × windowSize. Must be ≤ ring capacity.">
                    <span className={clsx(
                        'text-sm font-mono',
                        config.avgSize * config.windowSize > config.ringCapacity
                            ? 'text-red-400'
                            : 'text-gray-300',
                    )}>
                        {(config.avgSize * config.windowSize).toLocaleString()}
                        {config.avgSize * config.windowSize > config.ringCapacity && (
                            <span className="text-red-400 text-[10px] ml-1">exceeds capacity!</span>
                        )}
                    </span>
                </SettingsEntry>
            </SettingsEntryGroup>
        </div>
    );
};

const ChannelsPanel: React.FC = () => {
    const config = useScopeStore((s) => s.config);

    const toggle = (ch: 'v' | 'i' | 'w') => {
        useScopeStore.getState().setConfig({
            channels: { ...config.channels, [ch]: !config.channels[ch] },
        });
    };

    const entries = [
        { id: 'v' as const, label: 'Voltage', icon: Zap, color: 'text-yellow-400' },
        { id: 'i' as const, label: 'Current', icon: Activity, color: 'text-cyan-400' },
        { id: 'w' as const, label: 'Power', icon: Gauge, color: 'text-fuchsia-400' },
    ];

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Channel Visibility" description="Show or hide each measurement channel on the scope graph.">
                {entries.map((ch) => (
                    <SettingsEntry key={ch.id} label={ch.label}>
                        <div className="flex items-center gap-2">
                            <ch.icon size={14} className={ch.color} />
                            <Toggle
                                enabled={config.channels[ch.id]}
                                onChange={() => toggle(ch.id)}
                            />
                        </div>
                    </SettingsEntry>
                ))}
            </SettingsEntryGroup>
        </div>
    );
};

const DisplayPanel: React.FC = () => {
    const engineRef = useScopeStore((s) => s.engineRef);
    const status = useScopeStore((s) => s.status);

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Status" description="Current scope display information.">
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="bg-gray-800 rounded-md p-3 space-y-1">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Mode</span>
                        <div className="text-sm text-gray-200 font-mono">{status.mode}</div>
                    </div>
                    <div className="bg-gray-800 rounded-md p-3 space-y-1">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Observations</span>
                        <div className="text-sm text-gray-200 font-mono">{status.observationCount}</div>
                    </div>
                    <div className="bg-gray-800 rounded-md p-3 space-y-1">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Buffer fill</span>
                        <div className="text-sm text-gray-200 font-mono">{(status.bufferFillPct * 100).toFixed(1)}%</div>
                    </div>
                    <div className="bg-gray-800 rounded-md p-3 space-y-1">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Raw smp/s</span>
                        <div className="text-sm text-gray-200 font-mono">{status.samplesPerSec}</div>
                    </div>
                </div>
            </SettingsEntryGroup>

            {engineRef && (
                <SettingsEntryGroup title="Behavior" description="Control how the scope graph responds to incoming data.">
                    <SettingsEntry label="Live follow" description="When enabled, the graph scrolls with new data. Disable to browse history.">
                        <Toggle
                            enabled={engineRef.followIngest}
                            onChange={(v) => { engineRef.followIngest = v; }}
                        />
                    </SettingsEntry>
                </SettingsEntryGroup>
            )}
        </div>
    );
};

// ── Modal ──

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
    const [activeCategory, setActiveCategory] = useState('buffer');

    if (!open) return null;

    const panels: Record<string, React.ReactNode> = {
        buffer: <BufferPanel />,
        channels: <ChannelsPanel />,
        display: <DisplayPanel />,
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex overflow-hidden"
                style={{
                    width: 'min(75vw, 900px)',
                    height: 'min(90vh, 700px)',
                    minWidth: '580px',
                    minHeight: '400px',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Sidebar ── */}
                <div className="w-44 bg-gray-800/80 border-r border-gray-700 flex flex-col shrink-0">
                    <div className="h-10 flex items-center px-4 border-b border-gray-700/50">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Settings</span>
                    </div>
                    <nav className="flex-1 py-2 space-y-0.5">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={clsx(
                                    'w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors text-left',
                                    activeCategory === cat.id
                                        ? 'bg-blue-600/20 text-blue-300 border-r-2 border-blue-500'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/40',
                                )}
                            >
                                <cat.icon size={14} />
                                {cat.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* ── Content ── */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="h-10 flex items-center justify-between px-5 border-b border-gray-700/50 shrink-0">
                        <span className="text-sm font-medium text-gray-200">
                            {CATEGORIES.find((c) => c.id === activeCategory)?.label}
                        </span>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-200 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">
                        {panels[activeCategory]}
                    </div>
                </div>
            </div>
        </div>
    );
};
