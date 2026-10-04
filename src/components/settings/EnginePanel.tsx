import React from 'react';
import type { ScopeConfig } from '../../scope/types/engineTypes';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';
import { BlurInput } from './BlurInput';

// ── Helpers ──

/** Samples per observation after smoothing. */
function samplesPerObs(cfg: ScopeConfig): number {
    return cfg.packetSmoothing === -1 ? cfg.expectedSamplesPerPacket : cfg.packetSmoothing;
}
/** Observation rate (obs/s) after in-packet averaging. */
function obsRate(cfg: ScopeConfig): number {
    return cfg.nominalSampleRate / samplesPerObs(cfg);
}
/** Packet rate (packets/s). */
function pktRate(cfg: ScopeConfig): number {
    return cfg.nominalSampleRate / cfg.expectedSamplesPerPacket;
}

function ringSeconds(capacity: number, rate: number): number {
    return rate > 0 ? capacity / rate : 0;
}

// ── Props ──

interface EnginePanelProps {
    config: ScopeConfig;
    onChange: (patch: Partial<ScopeConfig>) => void;
}

// ── Component ──

export const EnginePanel: React.FC<EnginePanelProps> = ({ config, onChange }) => {
    const eRate = obsRate(config);
    const pps = pktRate(config);
    const ringSec = ringSeconds(config.ringCapacity, eRate);

    return (
        <div className="space-y-2">
            <SettingsEntryGroup title="Sample Rate" description="Expected sample rate from the device. Used for all time-based calculations below.">
                <SettingsEntry label="Nominal Raw rate" description="Raw samples per second from the device.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.nominalSampleRate}
                            onCommit={(v) => onChange({ nominalSampleRate: Math.max(1, v) })}
                            min={1}
                            max={10_000_000}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">sps</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Effective obs/s" description="Observation rate after in-packet averaging. Used for display timing.">
                    <span className="text-sm font-mono text-gray-300">{eRate.toFixed(1)}</span>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Packet Handling" description="How incoming raw samples are grouped into observations.">
                <SettingsEntry label="Samples per packet" description="Expected raw samples per device packet. Used to detect undersized packets.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.expectedSamplesPerPacket}
                            onCommit={(v) => onChange({ expectedSamplesPerPacket: Math.max(1, Math.round(v)) })}
                            min={1}
                            max={10000}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">samples</span>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Smoothing group" description="How many raw samples to average into one observation. -1 = entire packet. Cannot exceed samples per packet.">
                    <div className="flex items-center gap-1.5">
                        <BlurInput
                            value={config.packetSmoothing}
                            onCommit={(v) => {
                                const val = v === -1 ? -1 : Math.max(1, Math.min(Math.round(v), config.expectedSamplesPerPacket));
                                onChange({ packetSmoothing: val });
                            }}
                            min={-1}
                            max={config.expectedSamplesPerPacket}
                            display={(v) => v === -1 ? '-1' : String(v)}
                            parse={(s) => s.trim() === '-1' ? -1 : parseInt(s, 10)}
                            extraValidate={(v) => v === -1 ? -1 : Math.max(1, Math.min(Math.round(v), config.expectedSamplesPerPacket))}
                        />
                        <span className="text-[11px] text-gray-500 font-mono">samples</span>
                    </div>
                </SettingsEntry>
                {/* <SettingsEntry label="Observations per packet" description="Observations yielded per packet after smoothing.">
                    <span className="text-sm font-mono text-gray-300">{opp.toFixed(1)}</span>
                </SettingsEntry>
                <SettingsEntry label="Samples per observation" description="Raw samples averaged into each observation.">
                    <span className="text-sm font-mono text-gray-300">{spo.toFixed(0)}</span>
                </SettingsEntry> */}
                <SettingsEntry label="Expected Packets/s" description="Incoming packet rate at current sample rate.">
                    <span className="text-sm font-mono text-gray-300">{pps.toFixed(1)}</span>
                </SettingsEntry>
            </SettingsEntryGroup>

            <SettingsEntryGroup title="Raw Ring Buffer" description="The raw ring stores every observation (post packet-smoothing).">
                <SettingsEntry label="Ring capacity" description="Maximum raw observations stored. Applies after reconnect.">
                    <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1.5">
                            <BlurInput
                                value={config.ringCapacity}
                                onCommit={(v) => {
                                    const clamped = Math.max(1, Math.min(10_000_000, Math.round(v)));
                                    onChange({ ringCapacity: clamped });
                                }}
                                min={1}
                                max={10_000_000}
                            />
                            <span className="text-[11px] text-gray-500 font-mono">slots</span>
                        </div>
                    </div>
                </SettingsEntry>
                <SettingsEntry label="Ring history" description="Total time span covered by the raw ring at current observation rate.">
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-sm font-mono text-gray-300">
                            {ringSec.toFixed(1)} s
                        </span>
                        <span className="text-[10px] text-gray-500">
                            {config.ringCapacity.toLocaleString()} obs @ {eRate.toFixed(0)} obs/s
                        </span>
                    </div>
                </SettingsEntry>
            </SettingsEntryGroup>
        </div>
    );
};
