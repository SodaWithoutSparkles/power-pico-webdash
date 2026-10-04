import React from 'react';
import type { ScopeConfig } from '../../scope/types/engineTypes';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';
import { Toggle } from '../common/Toggle';
import { Zap, Activity, Gauge } from 'lucide-react';

// ── Props ──

interface ChannelsPanelProps {
    config: ScopeConfig;
    onChange: (patch: Partial<ScopeConfig>) => void;
}

// ── Channels Panel ──

export const ChannelsPanel: React.FC<ChannelsPanelProps> = ({ config, onChange }) => {
    const toggle = (ch: 'v' | 'i' | 'w') => {
        onChange({ channels: { ...config.channels, [ch]: !config.channels[ch] } });
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
