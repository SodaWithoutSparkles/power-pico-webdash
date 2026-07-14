import React from 'react';
import { MenuItem } from './MenuItem';

interface HelpMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
}

export const HelpMenu: React.FC<HelpMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'help' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('help')}
            >
                Help
            </div>
            {activeMenu === 'help' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="About" onClick={() => { alert('Power Pico WebDash v0.2.0\nReal-time scope monitor for the Power Pico'); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
