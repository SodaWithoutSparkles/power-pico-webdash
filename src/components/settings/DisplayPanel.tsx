import React from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { SettingsEntry } from './SettingsEntry';
import { SettingsEntryGroup } from './SettingsEntryGroup';
import { Toggle } from '../common/Toggle';

// ── Display Panel (behavior controls only; status moved to Diagnostics) ──

export const DisplayPanel: React.FC = () => {
    const engineRef = useScopeStore((s) => s.engineRef);

    return (
        <div className="space-y-2">
            {engineRef && (
                <SettingsEntryGroup title="Behavior" description="Control how the scope graph responds to incoming data.">
                    <SettingsEntry label="Live follow" description="When enabled, the graph scrolls with new data. Disable to browse history.">
                        <Toggle
                            enabled={engineRef.followIngest}
                            onChange={(v) => { engineRef.followIngest = v; }}
                        />
                    </SettingsEntry>
                    <SettingsEntry label="Cursor lock" description="When enabled and follow is off, cursor auto-advances at ingest rate.">
                        <Toggle
                            enabled={engineRef.cursorLocked}
                            onChange={(v) => { engineRef.cursorLocked = v; }}
                        />
                    </SettingsEntry>
                </SettingsEntryGroup>
            )}
            {!engineRef && (
                <p className="text-sm text-gray-500 italic">Connect a device or start simulation to see display controls.</p>
            )}
        </div>
    );
};
