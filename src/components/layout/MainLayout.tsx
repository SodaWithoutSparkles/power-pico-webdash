import React from 'react';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomBar } from './BottomBar';
import { ScopeCanvas } from '../../scope/ui/ScopeCanvas';
import { Measurements } from '../../scope/ui/Measurements';
import { useScopeEngineManager } from '../../scope/hooks/useScopeEngineManager';

export const MainLayout: React.FC = () => {
    // Boot the worker engine
    useScopeEngineManager();
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            {/* 1. Top Header */}
            <Header />

            {/* 2. Middle Section (Tools + Canvas + Panels) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Left Toolbar */}
                <LeftSidebar />

                {/* Center Canvas Area — scope graph */}
                <div className="flex-1 relative overflow-hidden">
                    <ScopeCanvas />
                </div>

                {/* Right Panel — settings + measurements */}
                <div className="flex flex-col border-l border-gray-700">
                    <div className="flex-1 overflow-y-auto">
                        <RightSidebar />
                    </div>
                    <div className="border-t border-gray-700 p-3 bg-gray-800/50">
                        <Measurements />
                    </div>
                </div>
            </div>

            {/* 3. Bottom Status Bar */}
            <BottomBar />
        </div>
    );
};
