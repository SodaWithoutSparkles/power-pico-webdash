import React from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { SettingsEntryGroup } from './SettingsEntryGroup';

// ── Diagnostics Panel ──

export const DiagnosticsPanel: React.FC = () => {
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);
    const sessionTotals = useScopeStore((s) => s.sessionTotals);
    const config = useScopeStore((s) => s.config);
    const hysteresisTier = useScopeStore((s) => s.hysteresisTier);
    const bucketCount = useScopeStore((s) => s.bucketCount);

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Engine Status" description="Current state of the scope engine.">
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <StatBox label="Mode" value={status.mode} />
                    <StatBox label="Running" value={String(status.running)} />
                    <StatBox label="Observations" value={status.observationCount.toLocaleString()} />
                    <StatBox label="Buffer fill" value={`${(status.bufferFillPct * 100).toFixed(1)}%`} />
                    <StatBox label="Raw smp/s" value={status.samplesPerSec.toLocaleString()} />
                    <StatBox label="Avg smp/pkt" value={status.avgSamplesPerPacket.toFixed(1)} />
                    <StatBox label="Last TS (μs)" value={status.lastTimestampUs.toLocaleString()} />
                    <StatBox label="Packet warning" value={status.packetWarning ?? 'none'} warn={!!status.packetWarning} />
                </div>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Display Pipeline" description="Current display ring and scale state.">
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <StatBox label="Engine ring len" value={engineRef ? engineRef.displayLength.toLocaleString() : '—'} />
                    <StatBox label="Raw ring len" value={engineRef ? engineRef.ring.length.toLocaleString() : '—'} />
                    <StatBox label="Hysteresis tier" value={hysteresisTier} />
                    <StatBox label="Viewport buckets" value={bucketCount.toLocaleString()} />
                    <StatBox label="Avg window size" value={config.avgSize.toLocaleString()} />
                    <StatBox label="Display capacity" value={config.windowSize.toLocaleString()} />
                </div>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Session Totals" description="Cumulative energy and charge since engine start.">
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <StatBox label="Energy" value={`${sessionTotals.energyJ.toFixed(3)} J`} />
                    <StatBox label="Charge" value={`${sessionTotals.chargeC.toFixed(3)} C`} />
                </div>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Live Values" description="Latest readings from the device.">
                <div className="grid grid-cols-3 gap-3 pt-2">
                    <StatBox label="Voltage" value={`${status.liveV.toFixed(3)} V`} />
                    <StatBox label="Current" value={`${(status.liveI * 1000).toFixed(2)} mA`} />
                    <StatBox label="Power" value={`${status.liveW.toFixed(3)} W`} />
                </div>
            </SettingsEntryGroup>
        </div>
    );
};

// ── Stat box ──

function StatBox({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
    return (
        <div className="bg-gray-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
            <div className={`text-sm font-mono ${warn ? 'text-red-400' : 'text-gray-200'}`}>
                {value}
            </div>
        </div>
    );
}
