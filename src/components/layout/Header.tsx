import React, { useState } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { FileMenu } from './header/FileMenu';
import { EditMenu } from './header/EditMenu';
import { OptionsMenu } from './header/OptionsMenu';
import { HelpMenu } from './header/HelpMenu';

export const Header: React.FC = () => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);
    const connectSerial = useScopeStore((s) => s.connectSerial);
    const disconnectSerial = useScopeStore((s) => s.disconnectSerial);

    const isRunning = status.running;
    const mode = status.mode;

    const toggleMenu = (menu: string) => {
        setActiveMenu(activeMenu === menu ? null : menu);
    };

    return (
        <div className="h-8 bg-gray-900 border-b border-gray-700 flex items-center px-2 text-sm text-gray-300 select-none relative z-50">
            {/* Menus */}
            <FileMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                isRunning={isRunning}
                mode={mode}
                onConnectSerial={connectSerial}
                onDisconnect={disconnectSerial}
                onStartSimulate={() => engineRef?.startSimulate()}
                onStart={() => engineRef?.start()}
                onPause={() => engineRef?.pause()}
                onClear={() => engineRef?.clear()}
                onSetTZero={() => engineRef?.setTZero(status.lastTimestampUs)}
                onExportScreenshot={() => {
                    const canvas = document.querySelector('canvas');
                    if (canvas) {
                        const link = document.createElement('a');
                        link.download = `scope-${Date.now()}.png`;
                        link.href = canvas.toDataURL();
                        link.click();
                    }
                }}
            />

            <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 flex items-center justify-center pointer-events-none">
                <span className="text-gray-600 text-xs font-mono tracking-widest">
                    POWER PICO WEBDASH
                </span>
            </div>

            <EditMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
            />

            <OptionsMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
            />

            <HelpMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
            />

            {/* Click backdrop to close menu */}
            {activeMenu && (
                <div className="fixed inset-0 z-[-1]" onClick={() => setActiveMenu(null)} />
            )}
        </div>
    );
};
