import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';
import { Crosshair, Play, Check } from 'lucide-react';
import clsx from 'clsx';

// ── Types ──

interface CalibrationTableRow {
    id: string;
    label: string;
    measured: number;
    expected: string;
    apply: boolean;
    unit: string;
}

type CalStep = 'idle' | 'prompt-disconnect' | 'measuring' | 'results';

// ── Blur-validated number input (same pattern as in SettingsModal) ──

interface FloatInputProps {
    value: number;
    onCommit: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    display?: (v: number) => string;
}

const FloatInput: React.FC<FloatInputProps> = ({
    value, onCommit, min, max, step, className, display,
}) => {
    const [text, setText] = useState(() => (display ? display(value) : String(value)));
    const [focused, setFocused] = useState(false);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    const fmt = useMemo(() => display ? display(value) : String(value), [value, display]);

    // Sync from store when not focused
    useEffect(() => {
        if (!focused && text !== fmt) {
            setText(fmt);
        }
    }, [fmt, focused]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleBlur = useCallback(() => {
        setFocused(false);
        const raw = Number(text);
        if (isNaN(raw)) { setText(fmt); return; }
        let clamped = raw;
        if (min !== undefined) clamped = Math.max(min, clamped);
        if (max !== undefined) clamped = Math.min(max, clamped);
        commitRef.current(clamped);
        setText(display ? display(clamped) : String(clamped));
    }, [text, min, max, display, fmt]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
    }, []);

    const handleFocus = useCallback(() => setFocused(true), []);

    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            step={step}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            className={className ?? "w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 text-right font-mono focus:outline-none focus:border-blue-500"}
        />
    );
};

// ── Calibrate Panel ──

export const CalibratePanel: React.FC = () => {
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);

    const [step, setStep] = useState<CalStep>('idle');
    const [progress, setProgress] = useState(0);
    const [measuring, setMeasuring] = useState(false);
    const [liveDisplayV, setLiveDisplayV] = useState(0);
    const [liveDisplayI, setLiveDisplayI] = useState(0);
    const [tableRows, setTableRows] = useState<CalibrationTableRow[]>([]);

    const meterConnected = status.mode === 'serial'; // Calibrating simulated data is not meaningful

    // Refs for measurement — read by RAF callback without causing effect re-runs
    const liveVRef = useRef(0);
    const liveIRef = useRef(0);
    const spsRef = useRef(0);
    const sppRef = useRef(0);
    const samplesRef = useRef<number[]>([]);
    const currentSamplesRef = useRef<number[]>([]);
    const spsSamplesRef = useRef<number[]>([]);
    const sppSamplesRef = useRef<number[]>([]);
    const startTsRef = useRef(0);
    const rafRef = useRef(0);
    const savedPausedRef = useRef(false);
    const savedOffsetsRef = useRef({ voltageOffset: 0, currentOffsetLow: 0, currentOffsetMid: 0, currentOffsetHigh: 0 });

    const DURATION_MS = 5000; // 5-second average

    // Keep refs in sync with store (no deps — set on every render)
    liveVRef.current = status.liveV;
    liveIRef.current = status.liveI;
    spsRef.current = status.samplesPerSec;
    sppRef.current = status.avgSamplesPerPacket;

    // ── Start auto-calibrate flow ──

    const handleStartAuto = useCallback(() => {
        setStep('prompt-disconnect');
    }, []);

    const handleConfirmDisconnect = useCallback(() => {
        // Save and zero out calibration offsets so we measure raw values
        if (engineRef) {
            savedPausedRef.current = engineRef.ingestingPaused;
            if (engineRef.ingestingPaused) {
                engineRef.ingestingPaused = false;
            }
            savedOffsetsRef.current = {
                voltageOffset: engineRef.voltageOffset,
                currentOffsetLow: engineRef.currentOffsetLow,
                currentOffsetMid: engineRef.currentOffsetMid,
                currentOffsetHigh: engineRef.currentOffsetHigh,
            };
            engineRef.voltageOffset = 0;
            engineRef.currentOffsetLow = 0;
            engineRef.currentOffsetMid = 0;
            engineRef.currentOffsetHigh = 0;
        }
        // Also zero the store config so displayed values match
        setConfig({ voltageOffset: 0, currentOffsetLow: 0, currentOffsetMid: 0, currentOffsetHigh: 0 });
        setStep('measuring');
        setProgress(0);
        samplesRef.current = [];
        currentSamplesRef.current = [];
        spsSamplesRef.current = [];
        sppSamplesRef.current = [];
        startTsRef.current = performance.now();
        setMeasuring(true);
    }, [engineRef, setConfig]);

    const handleCancel = useCallback(() => {
        // Restore paused state and calibration offsets
        if (engineRef) {
            engineRef.ingestingPaused = savedPausedRef.current;
            engineRef.voltageOffset = savedOffsetsRef.current.voltageOffset;
            engineRef.currentOffsetLow = savedOffsetsRef.current.currentOffsetLow;
            engineRef.currentOffsetMid = savedOffsetsRef.current.currentOffsetMid;
            engineRef.currentOffsetHigh = savedOffsetsRef.current.currentOffsetHigh;
        }
        // Restore store config to saved offsets
        setConfig({ ...savedOffsetsRef.current });
        setStep('idle');
        setProgress(0);
        setMeasuring(false);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }, [engineRef, setConfig]);

    // ── Sampling loop ──

    useEffect(() => {
        if (!measuring) return;

        const tick = () => {
            const elapsed = performance.now() - startTsRef.current;
            const pct = Math.min(1, elapsed / DURATION_MS);

            // Read from refs — always latest, no re-render dependency
            const v = liveVRef.current;
            const i = liveIRef.current;
            const sps = spsRef.current;

            setProgress(pct);
            setLiveDisplayV(v);
            setLiveDisplayI(i);

            // Collect samples
            samplesRef.current.push(v);
            currentSamplesRef.current.push(i);
            spsSamplesRef.current.push(sps);
            sppSamplesRef.current.push(sppRef.current);

            if (pct >= 1) {
                setMeasuring(false);
                computeResults();
                return;
            }
            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
        // Only re-run when measuring toggles. Refs keep live data accessible.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measuring]);

    // ── Compute averaged results ──

    const computeResults = useCallback(() => {
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const avgV = avg(samplesRef.current);
        const avgI = avg(currentSamplesRef.current);
        const avgSps = Math.round(avg(spsSamplesRef.current));
        const avgSpp = Math.round(avg(sppSamplesRef.current));

        // Debug dump
        console.log('[calibrate] === Calibration Results ===');
        console.log('[calibrate] Voltage (avg):', avgV, 'V /', (avgV * 1000).toFixed(2), 'mV /', (avgV * 1_000_000).toFixed(0), 'µV');
        console.log('[calibrate] Current (avg):', avgI, 'A /', (avgI * 1_000).toFixed(3), 'mA /', (avgI * 1_000_000).toFixed(0), 'µA');
        console.log('[calibrate] Samples/sec (avg):', avgSps);
        console.log('[calibrate] Samples/packet (avg):', avgSpp);
        console.log('[calibrate] Sample count: voltage=', samplesRef.current.length, 'current=', currentSamplesRef.current.length, 'sps=', spsSamplesRef.current.length, 'spp=', sppSamplesRef.current.length);

        setTableRows([
            { id: 'voltage', label: 'Voltage', measured: avgV, expected: '0', apply: false, unit: 'V' },
            { id: 'current', label: 'Current', measured: avgI, expected: '0', apply: true, unit: 'A' },
            { id: 'sps', label: 'Samples per second', measured: avgSps, expected: 'N/A', apply: true, unit: 'sps' },
            { id: 'spp', label: 'Samples per packet', measured: avgSpp, expected: 'N/A', apply: true, unit: 'samples' },
        ]);
        setStep('results');
    }, []);

    // ── Apply calibration results ──

    const handleApply = useCallback(() => {
        const patch: Partial<typeof config> = {};
        for (const row of tableRows) {
            if (!row.apply) continue;
            switch (row.id) {
                case 'voltage':
                    patch.voltageOffset = row.measured;
                    break;
                case 'current':
                    patch.currentOffsetLow = row.measured;
                    patch.currentOffsetMid = row.measured;
                    patch.currentOffsetHigh = row.measured;
                    break;
                case 'sps':
                    if (row.measured > 0) patch.nominalSampleRate = row.measured;
                    break;
                case 'spp':
                    if (row.measured > 0) patch.expectedSamplesPerPacket = row.measured;
                    break;
            }
        }
        console.log('[calibrate] Applied patch:', patch);
        setConfig(patch);
        // Sync offsets to the engine immediately
        if (engineRef) {
            engineRef.voltageOffset = patch.voltageOffset ?? engineRef.voltageOffset;
            engineRef.currentOffsetLow = patch.currentOffsetLow ?? engineRef.currentOffsetLow;
            engineRef.currentOffsetMid = patch.currentOffsetMid ?? engineRef.currentOffsetMid;
            engineRef.currentOffsetHigh = patch.currentOffsetHigh ?? engineRef.currentOffsetHigh;
        }
        // Sync non-offset changes (e.g. nominalSampleRate, expectedSamplesPerPacket) to engine
        useScopeStore.getState().applyConfigToEngine();
        setStep('idle');
    }, [tableRows, setConfig, engineRef]);

    // ── Toggle apply checkbox ──

    const toggleApply = useCallback((id: string) => {
        setTableRows((prev) =>
            prev.map((r) => (r.id === id ? { ...r, apply: !r.apply } : r))
        );
    }, []);

    // ── Render ──

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Manual Offsets" description="Key in known offset values to zero the meter. Values are displayed in µV / µA for convenience.">
                <SettingsEntry label="Voltage offset" description="Applied to voltage readings (µV).">
                    <div className="flex items-center gap-1.5">
                        <FloatInput
                            value={config.voltageOffset}
                            onCommit={(v) => {
                                setConfig({ voltageOffset: v });
                                if (engineRef) engineRef.voltageOffset = v;
                            }}
                            display={(v) => (v * 1_000_000).toFixed(0)}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">µV</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Current offset (Low)" description="Current offset for low range (µA).">
                    <div className="flex items-center gap-1.5">
                        <FloatInput
                            value={config.currentOffsetLow}
                            onCommit={(v) => {
                                setConfig({ currentOffsetLow: v });
                                if (engineRef) engineRef.currentOffsetLow = v;
                            }}
                            display={(v) => (v * 1_000_000).toFixed(1)}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">µA</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Current offset (Mid)" description="Current offset for mid range (µA).">
                    <div className="flex items-center gap-1.5">
                        <FloatInput
                            value={config.currentOffsetMid}
                            onCommit={(v) => {
                                setConfig({ currentOffsetMid: v });
                                if (engineRef) engineRef.currentOffsetMid = v;
                            }}
                            display={(v) => (v * 1_000_000).toFixed(1)}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">µA</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Current offset (High)" description="Current offset for high range (µA).">
                    <div className="flex items-center gap-1.5">
                        <FloatInput
                            value={config.currentOffsetHigh}
                            onCommit={(v) => {
                                setConfig({ currentOffsetHigh: v });
                                if (engineRef) engineRef.currentOffsetHigh = v;
                            }}
                            display={(v) => (v * 1_000_000).toFixed(1)}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">µA</span>
                    </div>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Auto Calibrate" description="Measure baseline values with no load connected to auto-compute offsets.">
                {step === 'idle' && (
                    <div className="pt-2">
                        <button
                            onClick={handleStartAuto}
                            disabled={!meterConnected}
                            className={clsx(
                                'flex items-center gap-2 px-4 py-2 text-sm rounded transition-colors',
                                meterConnected
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed',
                            )}
                        >
                            <Play size={14} />
                            Start Auto Calibrate
                        </button>
                        {!meterConnected && (
                            <p className="text-[11px] text-gray-500 mt-2">Connect the meter via Serial first.</p>
                        )}
                    </div>
                )}
            </SettingsEntryGroup>

            {/* ── Disconnect prompt modal ── */}
            {step === 'prompt-disconnect' && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={handleCancel}>
                    <div
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <Crosshair size={20} className="text-blue-400" />
                            <h3 className="text-base font-semibold text-gray-200">Prepare for Calibration</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            Disconnect any load from the meter output. The meter should be powered on and
                            running with <span className="text-gray-200 font-semibold">no load attached</span>.
                            Wait for the readings to stabilise, then confirm below.
                        </p>
                        <div className="flex items-center justify-between bg-gray-800 rounded-lg p-3 mb-5">
                            <span className="text-xs text-gray-400">Voltage</span>
                            <span className="text-sm font-mono text-yellow-400">{(status.liveV * 1_000_000).toFixed(0)} µV</span>
                            <span className="text-xs text-gray-400">Current</span>
                            <span className="text-sm font-mono text-cyan-400">{(status.liveI * 1_000_000).toFixed(1)} µA</span>
                        </div>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmDisconnect}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                            >
                                <Check size={14} />
                                Values are stable, start measurement
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Measuring modal ── */}
            {step === 'measuring' && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-md">
                        <h3 className="text-base font-semibold text-gray-200 mb-4">Measuring baseline...</h3>
                        <div className="w-full bg-gray-700 rounded-full h-3 mb-2 overflow-hidden">
                            <div
                                className="bg-blue-500 h-full rounded-full transition-all duration-200"
                                style={{ width: `${(progress * 100).toFixed(0)}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-500 text-right font-mono">
                            {(progress * 100).toFixed(0)}%
                        </p>
                        <div className="flex items-center justify-between mt-4 bg-gray-800 rounded-lg p-3">
                            <span className="text-xs text-gray-400">Voltage</span>
                            <span className="text-sm font-mono text-yellow-400">{(liveDisplayV * 1_000_000).toFixed(0)} µV</span>
                            <span className="text-xs text-gray-400">Current</span>
                            <span className="text-sm font-mono text-cyan-400">{(liveDisplayI * 1_000_000).toFixed(1)} µA</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Results modal ── */}
            {step === 'results' && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={handleCancel}>
                    <div
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-lg"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-semibold text-gray-200 mb-4">Calibration Results</h3>
                        <p className="text-xs text-gray-500 mb-4">
                            Measured baseline values with no load. Check items to apply as offsets or settings.
                        </p>

                        {/* Table header */}
                        <div className="grid grid-cols-[1fr_1fr_1fr_60px] gap-3 text-[11px] text-gray-500 uppercase tracking-wider px-3 pb-2 border-b border-gray-700">
                            <span>Item</span>
                            <span className="text-right">Measured</span>
                            <span className="text-right">Expected</span>
                            <span className="text-center">Apply</span>
                        </div>

                        {/* Table rows */}
                        <div className="divide-y divide-gray-700/40">
                            {tableRows.map((row) => (
                                <div
                                    key={row.id}
                                    className="grid grid-cols-[1fr_1fr_1fr_60px] gap-3 items-center px-3 py-2.5"
                                >
                                    <span className="text-sm text-gray-200">{row.label}</span>
                                    <span className="text-sm text-gray-300 font-mono text-right">
                                        {row.measured.toFixed(row.id === 'voltage' ? 4 : row.id === 'current' ? 6 : 0)}
                                    </span>
                                    <span className="text-sm text-gray-500 font-mono text-right">{row.expected}</span>
                                    <div className="flex justify-center">
                                        <input
                                            type="checkbox"
                                            checked={row.apply}
                                            onChange={() => toggleApply(row.id)}
                                            className="accent-blue-500 w-4 h-4 cursor-pointer"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 justify-end mt-6">
                            <button
                                onClick={handleCancel}
                                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Discard
                            </button>
                            <button
                                onClick={handleApply}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                            >
                                <Check size={14} />
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
