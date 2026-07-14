import React from 'react';
import { MenuItem } from './MenuItem';

interface EditMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
}

export const EditMenu: React.FC<EditMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'edit' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('edit')}
            >
                Edit
            </div>
            {activeMenu === 'edit' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="Copy Graph" onClick={() => { onCloseMenu(); }} />
                    <MenuItem label="Reset View" onClick={() => { onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
