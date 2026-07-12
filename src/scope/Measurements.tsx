// Phase 5 — Measurements panel. Live V/I/W, session integrators (J/Wh, C/mAh),
// and the drag-region readout (Δt, energy, charge). Sits above ScopeSettings.

import { useScopeStore } from "../store/scopeStore";
import { Eraser } from "lucide-react";

function fmtTime(us: number): string {
    if (us >= 1e9) return `${(us / 1e9).toFixed(2)} s`;
    if (us >= 1e6) return `${(us / 1e6).toFixed(2)} ms`;
    if (us >= 1e3) return `${(us / 1e3).toFixed(1)} µs`;
    return `${us} ns`;
}

function Readout({
    label,
    value,
    unit,
}: {
    label: string;
    value: string;
    unit: string;
}) {
    return (
        <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-sm font-mono text-gray-100">
                {value} <span className="text-gray-500 text-xs">{unit}</span>
            </span>
        </div>
    );
}

export function Measurements() {
    const liveV = useScopeStore((s) => s.liveV);
    const liveI = useScopeStore((s) => s.liveI);
    const liveW = useScopeStore((s) => s.liveW);
    const sessionEnergyJ = useScopeStore((s) => s.sessionEnergyJ);
    const sessionChargeC = useScopeStore((s) => s.sessionChargeC);
    const resetSessionIntegrators = useScopeStore((s) => s.resetSessionIntegrators);
    const region = useScopeStore((s) => s.region);
    const clearRegion = useScopeStore((s) => s.clearRegion);

    return (
        <div className="border-b border-gray-700 p-3 space-y-3">
            <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                    Live
                </div>
                <div className="space-y-0.5">
                    <Readout label="Voltage" value={liveV.toFixed(3)} unit="V" />
                    <Readout label="Current" value={liveI.toFixed(3)} unit="A" />
                    <Readout label="Power" value={liveW.toFixed(3)} unit="W" />
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Session
                    </span>
                    <button
                        onClick={resetSessionIntegrators}
                        className="text-gray-500 hover:text-gray-200"
                        title="Reset session integrators"
                    >
                        <Eraser size={14} />
                    </button>
                </div>
                <div className="space-y-0.5">
                    <Readout
                        label="Energy"
                        value={sessionEnergyJ.toFixed(3)}
                        unit={`J (${((sessionEnergyJ / 3600) || 0).toFixed(4)} Wh)`}
                    />
                    <Readout
                        label="Charge"
                        value={sessionChargeC.toFixed(4)}
                        unit={`C (${(sessionChargeC * 1000 || 0).toFixed(2)} mAh)`}
                    />
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Region
                    </span>
                    {region && (
                        <button
                            onClick={clearRegion}
                            className="text-gray-500 hover:text-gray-200"
                            title="Clear selection (Esc)"
                        >
                            <Eraser size={14} />
                        </button>
                    )}
                </div>
                {region ? (
                    <div className="space-y-0.5">
                        <Readout
                            label="Δt"
                            value={fmtTime(Math.abs(region.tEndUs - region.tStartUs))}
                            unit=""
                        />
                        <Readout
                            label="Energy"
                            value={region.energyJ.toFixed(3)}
                            unit={`J (${(region.energyJ / 3600 || 0).toFixed(4)} Wh)`}
                        />
                        <Readout
                            label="Charge"
                            value={region.chargeC.toFixed(4)}
                            unit={`C (${(region.chargeC * 1000 || 0).toFixed(2)} mAh)`}
                        />
                    </div>
                ) : (
                    <div className="text-xs text-gray-500">Drag on chart to select.</div>
                )}
            </div>
        </div>
    );
}
