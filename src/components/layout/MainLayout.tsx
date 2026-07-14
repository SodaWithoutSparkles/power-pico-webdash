import React from 'react';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomBar } from './BottomBar';
import { ScopeDebugPanel } from '../../scope/ScopeDebugPanel';

export const MainLayout: React.FC = () => {
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            {/* 1. Top Header */}
            <Header />

            {/* 2. Middle Section (Tools + Canvas + Panels) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Left Toolbar */}
                <LeftSidebar />

                {/* Center Canvas Area — scope graph */}
                <div className="flex-1 bg-gray-500 relative overflow-hidden flex flex-col">
                    <div className="flex-1 relative bg-gray-900">
                        <ScopeDebugPanel />
                    </div>
                </div>

                {/* Right Panels */}
                <RightSidebar />
            </div>

            {/* 3. Bottom Status Bar */}
            <BottomBar />
        </div>
    );
};
