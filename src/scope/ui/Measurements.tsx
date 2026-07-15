// Region selection result panel.
// Shows region selection results when a drag-selection is active.

import React from "react";
import { useScopeStore } from "../../store/scopeStore";

export const Measurements: React.FC = () => {
    const selection = useScopeStore((s) => s.selection);

    return (
        <div className="space-y-3 text-xs">
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
