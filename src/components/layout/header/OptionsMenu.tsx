import React, { useState } from 'react';
import { MenuItem } from './MenuItem';
import { SettingsModal } from '../../settings/SettingsModal';

interface OptionsMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
}

export const OptionsMenu: React.FC<OptionsMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
}) => {
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'option' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('option')}
            >
                Settings
            </div>
            {activeMenu === 'option' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="Settings..." onClick={() => { setSettingsOpen(true); onCloseMenu(); }} />
                    <MenuItem label="About" onClick={() => { alert('Power Pico WebDash v0.2.0\nScope Monitor'); onCloseMenu(); }} />
                </div>
            )}
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
};
