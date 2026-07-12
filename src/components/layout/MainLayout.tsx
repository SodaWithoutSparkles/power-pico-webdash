import React from 'react';
import { ScopeHeader } from '../../scope/ScopeHeader';
import { ScopeToolbar } from '../../scope/ScopeToolbar';
import { ScopeSettings } from '../../scope/ScopeSettings';
import { ScopeStatusBar } from '../../scope/ScopeStatusBar';
import { Measurements } from '../../scope/Measurements';
import { ScopeView } from '../../scope/ScopeView';

export const MainLayout: React.FC = () => {
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            {/* 1. Top Header */}
            <ScopeHeader />

            {/* 2. Middle Section (Tools + Scope + Panels) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Left Toolbar */}
                <ScopeToolbar />

                {/* Center Scope Area */}
                <ScopeView />

                {/* Right Panels */}
                <div className="flex flex-col w-64 shrink-0">
                    <Measurements />
                    <ScopeSettings />
                </div>
            </div>

            {/* 3. Bottom Status Bar */}
            <ScopeStatusBar />
        </div>
    );
};
