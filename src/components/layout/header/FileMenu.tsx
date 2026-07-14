import React from 'react';
import { MenuItem } from './MenuItem';

interface FileMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    isRunning: boolean;
    mode: string;
    onConnectSerial: () => void;
    onDisconnect: () => void;
    onStartSimulate: () => void;
    onStart: () => void;
    onPause: () => void;
    onClear: () => void;
    onSetTZero: () => void;
    onExportScreenshot: () => void;
}

export const FileMenu: React.FC<FileMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    isRunning,
    mode,
    onConnectSerial,
    onDisconnect,
    onStartSimulate,
    onStart,
    onPause,
    onClear,
    onSetTZero,
    onExportScreenshot,
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'file' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('file')}
            >
                File
            </div>
            {activeMenu === 'file' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    {mode === 'serial' ? (
                        <MenuItem label="Disconnect Serial" onClick={() => { onDisconnect(); onCloseMenu(); }} />
                    ) : (
                        <MenuItem label="Connect Serial…" onClick={() => { onConnectSerial(); onCloseMenu(); }} />
                    )}
                    <MenuItem label="Start Simulate" onClick={() => { onStartSimulate(); onCloseMenu(); }} />
                    <div className="h-px bg-gray-700 my-1" />
                    {isRunning ? (
                        <MenuItem label="Pause" onClick={() => { onPause(); onCloseMenu(); }} />
                    ) : (
                        <MenuItem label="Start" onClick={() => { onStart(); onCloseMenu(); }} />
                    )}
                    <MenuItem label="Clear" onClick={() => { onClear(); onCloseMenu(); }} />
                    <MenuItem label="Set T=0" onClick={() => { onSetTZero(); onCloseMenu(); }} />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label="Export Screenshot…" onClick={() => { onExportScreenshot(); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
