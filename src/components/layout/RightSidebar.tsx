import React, { useState, useRef } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { ChevronDown, ChevronRight, Eraser } from 'lucide-react';
import { peakToUnitValue, tierToLabel } from '../../scope/lib/hysteresis';
import { fmtSI, fmtCurrent } from '../../scope/format/formatValue';
import { LiveSmoother, SMOOTH_MODES } from '../../scope/lib/liveSmoother';
import type { SmoothMode } from '../../scope/lib/liveSmoother';

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

/** Split current value + unit using hysteresis tier. All tiers use 3dp for alignment. */
function fmtCurrentParts(amps: number, tier: "ua" | "ma" | "a"): { value: string; unit: string } {
    const scaled = peakToUnitValue(amps, tier);
    const unit = tierToLabel(tier);
    return { value: scaled.toFixed(3), unit };
}

/** Format microseconds to seconds with dp places. */
function fmtSec(us: number, dp: number): string {
    return (us / 1_000_000).toFixed(dp);
}

/** Format microseconds as a concise duration string with dp significant digits. */
function fmtDelta(us: number, digits: number): string {
    const s = us / 1_000_000;
    // Show as s or ms depending on magnitude
    if (s >= 1) return s.toPrecision(digits) + ' s';
    if (s >= 0.001) return (s * 1000).toPrecision(digits) + ' ms';
    return (s * 1_000_000).toPrecision(digits) + ' µs';
}

export const RightSidebar: React.FC = () => {
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);
    const status = useScopeStore((s) => s.status);
    const selection = useScopeStore((s) => s.selection);
    const sessionTotals = useScopeStore((s) => s.sessionTotals);
    const setSessionTotals = useScopeStore((s) => s.setSessionTotals);
    const engineRef = useScopeStore((s) => s.engineRef);
    const hysteresisTier = useScopeStore((s) => s.hysteresisTier);

    // Session toggle: false → mWh/mAh, true → J/C
    const [sessionInSI, setSessionInSI] = useState(false);
    // Selection toggle: false → mWh/mAh, true → J/C
    const [selInSI, setSelInSI] = useState(false);
    // Live smoothing mode
    const [smoothMode, setSmoothMode] = useState<SmoothMode>("Medium");

    // Live smoother — stable ref, updated on mode change
    const smootherRef = useRef<LiveSmoother>(null);
    if (!smootherRef.current) smootherRef.current = new LiveSmoother();
    smootherRef.current.mode = smoothMode;

    // Push raw status values through the smoother
    const now = performance.now();
    smootherRef.current.push(status.liveV, status.liveI, status.liveW, now);
    const smooth = smootherRef.current.getSmoothed();

    const cur = fmtCurrentParts(smooth.i, hysteresisTier);

    // mWh = energyJ / 3.6,  mAh = chargeC / 3.6
    const mwh = sessionTotals.energyJ / 3.6;
    const mah = sessionTotals.chargeC / 3.6;

    const handleClear = () => {
        engineRef?.integrator.reset();
        setSessionTotals({ energyJ: 0, chargeC: 0 });
    };

    return (
        <div className="w-64 flex-1 flex flex-col text-gray-300 z-20 relative">
            {/* ── Scrollable content area ── */}
            <div className={`flex-1 overflow-y-auto bg-gray-800 ${selection ? 'pb-56' : ''}`}>
                {/* ── Live values ── */}
                <div className="px-3 py-3 border-b border-gray-700/50">
                    <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1.5 flex items-center gap-2">
                        Live
                        <button
                            onClick={() => {
                                const idx = SMOOTH_MODES.indexOf(smoothMode);
                                setSmoothMode(SMOOTH_MODES[(idx + 1) % SMOOTH_MODES.length]);
                            }}
                            className="ml-auto text-[9px] font-mono font-normal normal-case tracking-normal px-1.5 py-0.5 rounded
                                       bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
                            title="Click to cycle smoothing mode"
                        >
                            {smoothMode}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {/* Row 1: V + mWh */}
                        <LiveCard value={fmtSI(smooth.v, "V", 3)} bg="bg-red-700" />
                        <SessionCard
                            value={sessionInSI ? sessionTotals.energyJ.toFixed(3) : mwh.toFixed(3)}
                            unit={sessionInSI ? 'J' : 'mWh'}
                            tooltipValue={sessionInSI ? mwh.toFixed(6) : sessionTotals.energyJ.toFixed(6)}
                            tooltipUnit={sessionInSI ? 'mWh' : 'J'}
                            onClick={() => setSessionInSI(!sessionInSI)}
                            bg="bg-gray-700"
                        />
                        {/* Row 2: I + mAh */}
                        <LiveCard value={`${cur.value} ${cur.unit}`} bg="bg-green-700" />
                        <SessionCard
                            value={sessionInSI ? sessionTotals.chargeC.toFixed(3) : mah.toFixed(3)}
                            unit={sessionInSI ? 'C' : 'mAh'}
                            tooltipValue={sessionInSI ? mah.toFixed(6) : sessionTotals.chargeC.toFixed(6)}
                            tooltipUnit={sessionInSI ? 'mAh' : 'C'}
                            onClick={() => setSessionInSI(!sessionInSI)}
                            bg="bg-gray-700"
                        />
                        {/* Row 3: P + clear button */}
                        <LiveCard value={fmtSI(smooth.w, "W", 3)} bg="bg-blue-700" />
                        <button
                            onClick={handleClear}
                            className="bg-gray-700 rounded-lg px-2.5 py-1.5 text-white/60 hover:text-white hover:bg-gray-600 transition-colors flex items-center justify-center gap-1.5 text-xs"
                            title="Clear session integrator"
                        >
                            <Eraser size={14} />
                            Clear
                        </button>
                    </div>
                </div>

                {/* ── Quick Settings (right below Live) ── */}
                <Section title="Quick Settings">
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
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400 w-20">Live smoothing</label>
                        <select
                            value={smoothMode}
                            onChange={(e) => setSmoothMode(e.target.value as SmoothMode)}
                            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                        >
                            {SMOOTH_MODES.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                </Section>
            </div>

            {/* ── Selection panel (absolute overlay, pinned to bottom) ── */}
            {selection && (
                <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-3 border-t border-gray-700/50 bg-gray-800">
                    <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1.5">
                        SELECTION (Δt {fmtDelta(selection.dtUs, 4)})
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        <SelCard label="From" value={fmtSec(selection.fromTs, 2)} unit="s" />
                        <SelCard label="To" value={fmtSec(selection.toTs, 2)} unit="s" />
                        <SelCard label="Peak V" value={fmtSI(selection.peakV, "V", 3)} textColor="text-yellow-400" />
                        <SelCard label="Avg V" value={fmtSI(selection.avgV, "V", 3)} textColor="text-yellow-400" />
                        <SelCard label="Peak I" value={fmtCurrent(selection.peakI, hysteresisTier)} textColor="text-cyan-400" />
                        <SelCard label="Avg I" value={fmtCurrent(selection.avgI, hysteresisTier)} textColor="text-cyan-400" />
                        <SelToggleCard
                            value={selInSI
                                ? fmtSI(selection.energyJ, 'J', 4)
                                : fmtSI(selection.energyJ / 3.6, 'Wh', 4)}
                            tooltip={selInSI
                                ? fmtSI(selection.energyJ / 3.6, 'Wh', 6)
                                : fmtSI(selection.energyJ, 'J', 6)}
                            onClick={() => setSelInSI(!selInSI)}
                            label="Energy"
                        />
                        <SelToggleCard
                            value={selInSI
                                ? fmtSI(selection.chargeC, 'C', 4)
                                : fmtSI(selection.chargeC / 3.6, 'Ah', 4)}
                            tooltip={selInSI
                                ? fmtSI(selection.chargeC / 3.6, 'Ah', 6)
                                : fmtSI(selection.chargeC, 'C', 6)}
                            onClick={() => setSelInSI(!selInSI)}
                            label="Charge"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Helpers ──

/** Split "-14.000 mV" → { sign: "-", num: "14.000", unit: "mV" }. */
function splitValue(value: string): { sign: string; num: string; unit: string } {
    const i = value.lastIndexOf(' ');
    const numPart = i > 0 ? value.slice(0, i) : value;
    const unit = i > 0 ? value.slice(i + 1) : '';
    const sign = numPart.startsWith('-') ? '-' : '';
    const num = sign ? numPart.slice(1) : numPart;
    return { sign, num, unit };
}

// ── Card components ──

/** Compact rounded card: sign-left, number-right, unit in fixed-width slot. */
function LiveCard({ value, bg }: { value: string; bg: string }) {
    const { sign, num, unit } = splitValue(value);
    return (
        <div className={`${bg} rounded-lg px-2.5 py-1.5 text-white`}>
            <div className="flex items-baseline gap-1">
                <span className="w-3 text-left text-sm font-bold font-mono leading-tight">{sign}</span>
                <span className="flex-1 text-right text-sm font-bold font-mono tabular-nums leading-tight">{num}</span>
                <span className="w-[1.25rem] text-right text-[10px] text-white/60 font-medium">{unit}</span>
            </div>
        </div>
    );
}

/** Clickable session card with tooltip showing alternate units at 6dp. */
function SessionCard({
    value, unit, tooltipValue, tooltipUnit, onClick, bg,
}: {
    value: string; unit: string; tooltipValue: string; tooltipUnit: string;
    onClick: () => void; bg: string;
}) {
    const sign = value.startsWith('-') ? '-' : '';
    const num = sign ? value.slice(1) : value;
    return (
        <button
            onClick={onClick}
            className={`${bg} rounded-lg px-2.5 py-1.5 text-white relative cursor-pointer hover:brightness-110 transition-all`}
            title={`${tooltipValue} ${tooltipUnit}`}
        >
            <div className="flex items-baseline gap-1">
                <span className="w-3 text-left text-sm font-bold font-mono leading-tight">{sign}</span>
                <span className="flex-1 text-right text-sm font-bold font-mono tabular-nums leading-tight">{num}</span>
                <span className="w-[1.25rem] text-right text-[10px] text-white/60 font-medium">{unit}</span>
            </div>
        </button>
    );
}

/** Selection card: small label above, sign-left, number-right, unit in fixed-width slot. */
function SelCard({ label, value, unit, textColor }: { label: string; value: string; unit?: string; textColor?: string }) {
    // Parse combined string like "14.000 mV" if no explicit unit given
    const i = value.lastIndexOf(' ');
    const numPart = i > 0 && !unit ? value.slice(0, i) : value;
    const unitPart = unit ?? (i > 0 ? value.slice(i + 1) : '');
    const sign = numPart.startsWith('-') ? '-' : '';
    const num = sign ? numPart.slice(1) : numPart;
    const tc = textColor ?? 'text-white';
    return (
        <div className="bg-gray-900/60 rounded-lg px-2 py-1.5 text-white">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">{label}</div>
            <div className="flex items-baseline gap-1">
                <span className={`w-3 text-left text-xs font-bold font-mono leading-tight ${tc}`}>{sign}</span>
                <span className={`flex-1 text-right text-xs font-bold font-mono tabular-nums leading-tight ${tc}`}>{num}</span>
                <span className="w-[1.25rem] text-right text-[9px] text-white/50 font-medium">{unitPart}</span>
            </div>
        </div>
    );
}

/** Selection toggle card: label, clickable value with tooltip showing alternate unit. */
function SelToggleCard({
    label, value, tooltip, onClick,
}: {
    label: string; value: string; tooltip: string;
    onClick: () => void;
}) {
    const i = value.lastIndexOf(' ');
    const numPart = i > 0 ? value.slice(0, i) : value;
    const unitPart = i > 0 ? value.slice(i + 1) : '';
    const sign = numPart.startsWith('-') ? '-' : '';
    const num = sign ? numPart.slice(1) : numPart;
    return (
        <button
            onClick={onClick}
            className="bg-gray-900/60 rounded-lg px-2 py-1.5 text-white cursor-pointer hover:brightness-110 transition-all text-left"
            title={tooltip}
        >
            <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">{label}</div>
            <div className="flex items-baseline gap-1">
                <span className="w-3 text-left text-xs font-bold font-mono leading-tight">{sign}</span>
                <span className="flex-1 text-right text-xs font-bold font-mono tabular-nums leading-tight">{num}</span>
                <span className="w-[1.25rem] text-right text-[9px] text-white/50 font-medium">{unitPart}</span>
            </div>
        </button>
    );
}
