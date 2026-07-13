// Phase 5 — Measurements panel. Live V/I/W, session integrators (J/Wh, C/mAh),
// and the drag-region readout (Δt, energy, charge). Sits above ScopeSettings.

import { useCallback, useRef } from "react";
import { useScopeStore } from "../store/scopeStore";
import { Download, Eraser } from "lucide-react";
import {
    autoCurrentUnit,
    autoPowerUnit,
    autoVoltageUnit,
    toUnitValue,
} from "../scope/ScopeEngine";
import { exportRegionCSV } from "./csvExport";
import type {
    CurrentUnit,
    PowerUnit,
    UnitMode,
    VoltageUnit,
} from "../scope/engineTypes";

function fmtTime(us: number): string {
    if (us >= 1e9) return `${(us / 1e9).toFixed(2)} s`;
    if (us >= 1e6) return `${(us / 1e6).toFixed(2)} ms`;
    if (us >= 1e3) return `${(us / 1e3).toFixed(1)} µs`;
    return `${us} ns`;
}

// Decimal places per display unit: u* → 1, m* → 2, base → 3.
function fmtUnit(value: number, unit: string): string {
    if (unit[0] === "u") return value.toFixed(1);
    if (unit[0] === "m") return value.toFixed(2);
    return value.toFixed(3);
}

// Energy auto-range (UI-only display logic). joules: J/kJ; watt-hours: mWh/Wh/kWh.
function autoEnergyUnit(
    joules: number,
    camp: "joules" | "watt-hours",
    _currentUnit: string,
): string {
    if (camp === "joules") return joules < 1000 ? "J" : "kJ";
    const wh = joules / 3600;
    if (wh < 1) return "mWh";
    if (wh < 1000) return "Wh";
    return "kWh";
}

function toEnergyValue(joules: number, unit: string): number {
    switch (unit) {
        case "kJ": return joules / 1000;
        case "mWh": return (joules / 3600) * 1000;
        case "Wh": return joules / 3600;
        case "kWh": return (joules / 3600) / 1000;
        case "J":
        default: return joules;
    }
}

function fmtEnergy(value: number, unit: string): string {
    if (unit === "mWh") return value.toFixed(2);
    return value.toFixed(3);
}

function Readout({
    label,
    value,
    unit,
    tag,
}: {
    label: string;
    value: string;
    unit: string;
    tag?: string;
}) {
    return (
        <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-sm font-mono text-gray-100">
                {value}{" "}
                <span className="text-gray-500 text-xs">{unit}</span>
                {tag && (
                    <span className="ml-1 text-gray-500 text-[10px] uppercase">
                        {tag}
                    </span>
                )}
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
    const config = useScopeStore((s) => s.config);
    const getEngine = useScopeStore((s) => s.getEngine);

    // Hysteresis refs: persist chosen display unit across renders.
    const vUnitRef = useRef<VoltageUnit>("V");
    const iUnitRef = useRef<CurrentUnit>("A");
    const wUnitRef = useRef<PowerUnit>("W");
    const prevVModeRef = useRef<UnitMode | null>(null);
    const prevIModeRef = useRef<UnitMode | null>(null);

    // Reset hysteresis when the unit mode changes.
    if (prevVModeRef.current !== config.vUnitMode) {
        vUnitRef.current = "V";
        prevVModeRef.current = config.vUnitMode;
    }
    if (prevIModeRef.current !== config.iUnitMode) {
        iUnitRef.current = "A";
        prevIModeRef.current = config.iUnitMode;
    }

    // Latest current range from the engine snapshot (LOW=1, MID=2, HIGH=3, 0=none).
    const snap = getEngine().snapshot();
    const currentRange = snap.range.length > 0 ? snap.range[snap.range.length - 1] : 0;
    const rangeLabel =
        currentRange === 1 ? "LOW" : currentRange === 2 ? "MID" : currentRange === 3 ? "HIGH" : "";

    // Voltage unit: off → fixed; si/meter → auto (meter N/A for V, falls back to SI).
    let vUnit: VoltageUnit;
    if (config.vUnitMode === "off") {
        vUnit = config.vFixedUnit;
    } else {
        vUnit = autoVoltageUnit(liveV, vUnitRef.current);
        vUnitRef.current = vUnit;
    }

    // Current unit: off → fixed; meter → range; si → auto.
    let iUnit: CurrentUnit;
    if (config.iUnitMode === "off") {
        iUnit = config.iFixedUnit;
    } else if (config.iUnitMode === "meter") {
        iUnit = currentRange === 1 ? "uA" : currentRange === 2 ? "mA" : "A";
    } else {
        iUnit = autoCurrentUnit(liveI, iUnitRef.current);
        iUnitRef.current = iUnit;
    }

    // Power unit: always SI auto.
    const wUnit = autoPowerUnit(liveW, wUnitRef.current);
    wUnitRef.current = wUnit;

    const handleExport = useCallback(() => {
        if (!region) return;
        const { config, getEngine } = useScopeStore.getState();
        exportRegionCSV(getEngine(), region.tStartUs, region.tEndUs, config.vZeroOffsetV, config.iZeroOffsetA);
    }, [region]);

    const vDisp = fmtUnit(toUnitValue(liveV, vUnit), vUnit);
    const iDisp = fmtUnit(toUnitValue(liveI, iUnit), iUnit);
    const wDisp = fmtUnit(toUnitValue(liveW, wUnit), wUnit);

    // Energy (session + region) auto-ranged by camp.
    const sEUnit = autoEnergyUnit(sessionEnergyJ, config.energyCamp, "J");
    const sEDisp = fmtEnergy(toEnergyValue(sessionEnergyJ, sEUnit), sEUnit);
    const rEUnit = region ? autoEnergyUnit(region.energyJ, config.energyCamp, "J") : "J";

    return (
        <div className="border-b border-gray-700 p-3 space-y-3">
            <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                    Live
                </div>
                <div className="space-y-0.5">
                    <Readout label="Voltage" value={vDisp} unit={vUnit} />
                    <Readout
                        label="Current"
                        value={iDisp}
                        unit={iUnit}
                        tag={config.iUnitMode === "meter" ? rangeLabel : undefined}
                    />
                    <Readout label="Power" value={wDisp} unit={wUnit} />
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
                    <Readout label="Energy" value={sEDisp} unit={sEUnit} />
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
                        <div className="flex gap-1">
                            <button onClick={handleExport} className="text-gray-500 hover:text-gray-200" title="Export region as CSV">
                                <Download size={14} />
                            </button>
                            <button
                                onClick={clearRegion}
                                className="text-gray-500 hover:text-gray-200"
                                title="Clear selection (Esc)"
                            >
                                <Eraser size={14} />
                            </button>
                        </div>
                    )}
                </div>
                {region ? (
                    <div className="space-y-0.5">
                        <Readout label="T+start" value={fmtTime(region.tStartUs)} unit="" />
                        <Readout label="T+end" value={fmtTime(region.tEndUs)} unit="" />
                        <Readout
                            label="Elapsed"
                            value={fmtTime(Math.abs(region.tEndUs - region.tStartUs))}
                            unit=""
                        />

                        <div className="border-t border-gray-700 my-1" />

                        {region.vAvg !== null && config.channels.v && (
                            <Readout
                                label="V"
                                value={`${fmtUnit(toUnitValue(region.vAvg, vUnit), vUnit)} (min ${fmtUnit(toUnitValue(region.vMin!, vUnit), vUnit)} / max ${fmtUnit(toUnitValue(region.vMax!, vUnit), vUnit)})`}
                                unit={vUnit}
                            />
                        )}
                        {region.iAvg !== null && config.channels.i && (
                            <Readout
                                label="I"
                                value={`${fmtUnit(toUnitValue(region.iAvg, iUnit), iUnit)} (min ${fmtUnit(toUnitValue(region.iMin!, iUnit), iUnit)} / max ${fmtUnit(toUnitValue(region.iMax!, iUnit), iUnit)})`}
                                unit={iUnit}
                            />
                        )}
                        {region.wAvg !== null && config.channels.w && (
                            <Readout
                                label="W"
                                value={`${fmtUnit(toUnitValue(region.wAvg, wUnit), wUnit)} (min ${fmtUnit(toUnitValue(region.wMin!, wUnit), wUnit)} / max ${fmtUnit(toUnitValue(region.wMax!, wUnit), wUnit)})`}
                                unit={wUnit}
                            />
                        )}

                        <div className="border-t border-gray-700 my-1" />

                        <Readout
                            label="Energy"
                            value={fmtEnergy(
                                toEnergyValue(region.energyJ, rEUnit),
                                rEUnit,
                            )}
                            unit={rEUnit}
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
