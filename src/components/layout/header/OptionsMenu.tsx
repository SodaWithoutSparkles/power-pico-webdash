import React from 'react';
import { MenuItem } from './MenuItem';

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
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'option' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('option')}
            >
                Options
            </div>
            {activeMenu === 'option' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="About" onClick={() => { alert('Power Pico WebDash v0.2.0\nScope Monitor'); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
