import React from 'react';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomBar } from './BottomBar';
import { ScopeView } from '../../scope/ScopeView';

export const MainLayout: React.FC = () => {
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            {/* 1. Top Header */}
            <Header />

            {/* 2. Middle Section (Tools + Scope + Panels) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Left Toolbar */}
                <LeftSidebar />

                {/* Center Scope Area */}
                <ScopeView />

                {/* Right Panels */}
                <RightSidebar />
            </div>

            {/* 3. Bottom Status Bar */}
            <BottomBar />
        </div>
    );
};
