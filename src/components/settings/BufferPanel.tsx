import React from 'react';
import type { ScopeConfig, BucketWidthMode } from '../../scope/types/engineTypes';
import { useScopeStore } from '../../store/scopeStore';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';
import { BlurInput } from './BlurInput';
import clsx from 'clsx';

// ── Time-domain helpers (use effective observation rate) ──

function samplesPerObs(cfg: ScopeConfig): number {
    return cfg.packetSmoothing === -1 ? cfg.expectedSamplesPerPacket : cfg.packetSmoothing;
}
function obsRate(cfg: ScopeConfig): number {
    return cfg.nominalSampleRate / samplesPerObs(cfg);
}
function toMs(avgSize: number, rate: number): number {
    return rate > 0 ? (avgSize / rate) * 1000 : 0;
}
function toSamples(ms: number, rate: number): number {
    return Math.max(1, Math.round((ms / 1000) * rate));
}

// ── Props ──

interface BufferPanelProps {
    config: ScopeConfig;
    onChange: (patch: Partial<ScopeConfig>) => void;
}

// ── Buffer Panel (display-level buffer settings only) ──

export const BufferPanel: React.FC<BufferPanelProps> = ({ config, onChange }) => {
    const bucketCount = useScopeStore((s) => s.bucketCount);
    const chartWidth = useScopeStore((s) => s.chartWidth);
    const eRate = obsRate(config);

    const avgMs = toMs(config.avgSize, eRate);

    // Used observation slots = avgSize × windowSize
    const usedObs = config.avgSize * config.windowSize;
    const exceeds = usedObs > config.ringCapacity;

    // Actual chart width from ResizeObserver
    const chartPxEst = chartWidth > 0 ? chartWidth : bucketCount;

    // Visible time span = bucketCount × avgSize / obsRate
    const visibleSec = bucketCount * config.avgSize / eRate;

    const modeOptions: { value: BucketWidthMode; label: string }[] = [
        { value: 'auto', label: 'Auto' },
        { value: 'semi-auto', label: 'Semi-auto' },
        { value: 'manual', label: 'Manual' },
    ];

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Viewport" description="How many display buckets fit on screen. Bucket count adapts to chart width.">
                <SettingsEntry label="Chart width" description="Computed chart width from current bucket count.">
                    <span className="text-sm font-mono text-gray-300">{chartPxEst} px</span>
                </SettingsEntry>
                <SettingsEntry label="Bucket count" description="Number of display buckets visible on screen.">
                    <span className="text-sm font-mono text-gray-300">{bucketCount}</span>
                </SettingsEntry>
                {isFinite(visibleSec) && visibleSec > 0 && (
                    <SettingsEntry label="Visible span" description="Total visible time on screen (derived).">
                        <span className="text-sm font-mono text-gray-300">{visibleSec.toFixed(2)} s</span>
                    </SettingsEntry>
                )}
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Bucket Width" description="Controls how observations are grouped into display buckets.">
                <SettingsEntry label="Mode" description="Auto = engine default ratio. Semi-auto = custom px/bucket ratio. Manual = fixed obs/bucket.">
                    <select
                        value={config.bucketWidthMode}
                        onChange={(e) => onChange({ bucketWidthMode: e.target.value as BucketWidthMode })}
                        className="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    >
                        {modeOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </SettingsEntry>

                {config.bucketWidthMode === 'semi-auto' && (
                    <SettingsEntry label="Buckets/px" description="How many display buckets per pixel of chart width. Lower = more zoomed in.">
                        <div className="flex items-center gap-1.5">
                            <BlurInput
                                value={config.bucketsPerPx}
                                onCommit={(v) => onChange({ bucketsPerPx: Math.max(0.1, Math.min(20, v)) })}
                                min={0.1}
                                max={20}
                                step={0.1}
                                display={(v) => v.toFixed(1)}
                                parse={(s) => parseFloat(s)}
                                extraValidate={(v) => Math.max(0.1, Math.min(20, v))}
                            />
                            <span className="text-[11px] text-gray-500 font-mono">buckets/px</span>
                        </div>
                    </SettingsEntry>
                )}

                {config.bucketWidthMode === 'manual' && (
                    <SettingsEntry label="Bucket width" description="Time span per averaged bucket.">
                        <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center gap-1.5">
                                <BlurInput
                                    value={avgMs}
                                    onCommit={(ms) => {
                                        const newAvg = toSamples(ms, eRate);
                                        const capped = Math.min(newAvg, Math.floor(config.ringCapacity / config.windowSize));
                                        const clamped = Math.max(1, capped);
                                        onChange({ avgSize: clamped });
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
                )}

                <SettingsEntry label="Avg mode" description="LTTB preserves shape with fewer points; simple shows min/max envelopes.">
                    <select
                        value={config.avgMode}
                        onChange={(e) => onChange({ avgMode: e.target.value as 'simple' | 'lttb' })}
                        className="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    >
                        <option value="simple">Min-max-avg</option>
                        <option value="lttb">LTTB</option>
                    </select>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Display Range" description="How the display window is sized.">
                <SettingsEntry label="Display ring size" description="Number of display buckets stored in the ring.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.windowSize}
                            onCommit={(v) => {
                                const clamped = Math.max(bucketCount, Math.round(v));
                                onChange({ windowSize: clamped });
                            }}
                            min={bucketCount}
                            max={100000}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">buckets</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Used obs slots" description="Observation slots consumed by the display window. Must be ≤ ring capacity.">
                    <div className="flex flex-col items-end gap-0.5">
                        <span className={clsx('text-sm font-mono', exceeds ? 'text-red-400' : 'text-gray-300')}>
                            {usedObs.toLocaleString()}
                            <span className="text-[10px] ml-1 text-gray-500">/ {config.ringCapacity.toLocaleString()}</span>
                        </span>
                        {exceeds && (
                            <span className="text-red-400 text-[10px]">exceeds capacity!</span>
                        )}
                    </div>
                </SettingsEntry>
            </SettingsEntryGroup>
        </div>
    );
};
