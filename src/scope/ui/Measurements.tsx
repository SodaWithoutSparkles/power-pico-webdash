// Live/session/region measurement readout panel.
// Shows instant V/I/W, session energy/charge, and region selection results.

import React from "react";
import { useScopeStore } from "../../store/scopeStore";
import { peakToUnitValue, tierToLabel, type ScaleTier } from "../lib/hysteresis";

function fmtCurrent(amps: number, tier: ScaleTier): string {
    const scaled = peakToUnitValue(amps, tier);
    const label = tierToLabel(tier);
    switch (tier) {
        case "ua": return scaled.toFixed(0) + " " + label;
        case "ma": return scaled.toFixed(2) + " " + label;
        case "a": return scaled.toFixed(3) + " " + label;
    }
}

export const Measurements: React.FC = () => {
    const status = useScopeStore((s) => s.status);
    const selection = useScopeStore((s) => s.selection);
    const sessionTotals = useScopeStore((s) => s.sessionTotals);
    const hysteresisTier = useScopeStore((s) => s.hysteresisTier);

    return (
        <div className="space-y-3 text-xs">
            {/* Live values */}
            <div className="bg-gray-900/50 rounded p-2 space-y-1">
                <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">
                    Live
                </div>
                <Row label="V" value={`${status.liveV.toFixed(3)} V`} color="text-yellow-400" />
                <Row label="I" value={fmtCurrent(status.liveI, hysteresisTier)} color="text-cyan-400" />
                <Row label="P" value={`${status.liveW.toFixed(3)} W`} color="text-fuchsia-400" />
            </div>

            {/* Session totals */}
            {(sessionTotals.energyJ > 0 || sessionTotals.chargeC > 0) && (
                <div className="bg-gray-900/50 rounded p-2 space-y-1">
                    <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">
                        Session
                    </div>
                    <Row label="Energy" value={`${sessionTotals.energyJ.toFixed(3)} J`} />
                    <Row label="Charge" value={`${sessionTotals.chargeC.toFixed(3)} C`} />
                </div>
            )}

            {/* Region selection */}
            {selection && (
                <div className="bg-gray-900/50 rounded p-2 space-y-1">
                    <div className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">
                        Selection
                    </div>
                    <Row label="Δt" value={`${(selection.dtUs / 1_000_000).toFixed(3)} s`} />
                    <Row label="Energy" value={`${selection.energyJ.toFixed(6)} J`} />
                    <Row label="Charge" value={`${selection.chargeC.toFixed(6)} C`} />
                </div>
            )}
        </div>
    );
};

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-gray-400 font-mono">{label}</span>
            <span className={`font-mono tabular-nums ${color ?? 'text-white'}`}>{value}</span>
        </div>
    );
}
