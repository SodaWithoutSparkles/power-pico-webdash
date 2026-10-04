import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Monitor, Sliders, Crosshair, Wrench, Activity } from 'lucide-react';
import clsx from 'clsx';
import type { ScopeConfig } from '../../scope/types/engineTypes';
import { useScopeStore } from '../../store/scopeStore';
import { EnginePanel } from './EnginePanel';
import { BufferPanel } from './BufferPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { DisplayPanel } from './DisplayPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { CalibratePanel } from './CalibratePanel';

// ── Category definitions ──

interface Category {
    id: string;
    label: string;
    icon: React.FC<{ size?: number; className?: string }>;
}

const CATEGORIES: Category[] = [
    { id: 'engine', label: 'Engine', icon: Wrench },
    { id: 'channels', label: 'Channels', icon: Sliders },
    { id: 'display', label: 'Display', icon: Monitor },
    { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
    { id: 'calibrate', label: 'Calibrate', icon: Crosshair },
];

// Fields managed by the draft/apply system (not calibration which applies immediately).
const MODAL_CONFIG_KEYS: (keyof ScopeConfig)[] = [
    'ringCapacity', 'avgSize', 'windowSize', 'avgMode',
    'channels', 'nominalSampleRate', 'expectedSamplesPerPacket', 'packetSmoothing',
    'bucketWidthMode', 'bucketsPerPx',
];

function modalPatch(a: ScopeConfig, b: ScopeConfig): Partial<ScopeConfig> {
    const patch: Partial<ScopeConfig> = {};
    for (const key of MODAL_CONFIG_KEYS) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
            (patch as Record<string, unknown>)[key] = a[key];
        }
    }
    return patch;
}

function modalKeysEqual(a: ScopeConfig, b: ScopeConfig): boolean {
    return Object.keys(modalPatch(a, b)).length === 0;
}

// ── Modal ──

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
    const [activeCategory, setActiveCategory] = useState('engine');
    const [draftConfig, setDraftConfig] = useState<ScopeConfig>(() => ({ ...useScopeStore.getState().config }));
    const liveConfig = useScopeStore((s) => s.config);

    // Reset draft when modal opens
    useEffect(() => {
        if (open) {
            setDraftConfig({ ...liveConfig });
            setActiveCategory('engine');
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const isDirty = !modalKeysEqual(draftConfig, liveConfig);

    const handleChange = useCallback((patch: Partial<ScopeConfig>) => {
        setDraftConfig((prev) => ({ ...prev, ...patch }));
    }, []);

    const validationError = useMemo(() => {
        const c = draftConfig;
        // Smoothing group must be <= expectedSamplesPerPacket (when not -1)
        if (c.packetSmoothing !== -1 && c.packetSmoothing > c.expectedSamplesPerPacket) {
            return 'Smoothing group cannot exceed samples per packet';
        }
        // Ring capacity must be >= what the display window consumes
        if (c.avgSize * c.windowSize > c.ringCapacity) {
            return 'Display window (avgSize × windowSize) exceeds ring capacity';
        }
        return null;
    }, [draftConfig]);

    const handleApply = useCallback(() => {
        if (validationError) return;
        const store = useScopeStore.getState();
        const live = store.config;
        const patch = modalPatch(draftConfig, live);
        if (Object.keys(patch).length === 0) return;
        store.setConfig(patch);
        store.applyConfigToEngine();
    }, [draftConfig, validationError]);

    const handleClose = useCallback(() => {
        if (isDirty) {
            const ok = window.confirm(
                'You have unsaved changes. Discard them?',
            );
            if (!ok) return;
        }
        onClose();
    }, [isDirty, onClose]);

    if (!open) return null;

    // Render panels — pass draft config + onChange to panels that modify config
    const enginePanel = <EnginePanel config={draftConfig} onChange={handleChange} />;
    const channelsPanel = <ChannelsPanel config={draftConfig} onChange={handleChange} />;
    const displayPanel = (
        <div className="space-y-4">
            <BufferPanel config={draftConfig} onChange={handleChange} />
            <hr className="border-gray-700/50" />
            <DisplayPanel />
        </div>
    );
    const diagnosticsPanel = <DiagnosticsPanel />;
    const calibratePanel = <CalibratePanel />;

    const panels: Record<string, React.ReactNode> = {
        engine: enginePanel,
        channels: channelsPanel,
        display: displayPanel,
        diagnostics: diagnosticsPanel,
        calibrate: calibratePanel,
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onMouseDown={handleClose}>
            <div
                className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex overflow-hidden"
                style={{
                    width: 'min(75vw, 900px)',
                    height: 'min(90vh, 700px)',
                    minWidth: '580px',
                    minHeight: '400px',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* ── Sidebar ── */}
                <div className="w-44 bg-gray-800/80 border-r border-gray-700 flex flex-col shrink-0">
                    <div className="h-10 flex items-center px-4 border-b border-gray-700/50">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Settings</span>
                    </div>
                    <nav className="flex-1 py-2 space-y-0.5">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={clsx(
                                    'w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors text-left',
                                    activeCategory === cat.id
                                        ? 'bg-blue-600/20 text-blue-300 border-r-2 border-blue-500'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/40',
                                )}
                            >
                                <cat.icon size={14} />
                                {cat.label}
                            </button>
                        ))}
                    </nav>

                    {/* ── Apply / Revert footer ── */}
                    {isDirty && (
                        <div className="border-t border-gray-700/50 p-3 space-y-1.5">
                            {validationError && (
                                <div className="text-[10px] text-red-400 leading-tight px-0.5">
                                    {validationError}
                                </div>
                            )}
                            <button
                                onClick={handleApply}
                                disabled={!!validationError}
                                className={clsx(
                                    'w-full text-xs font-medium py-1.5 rounded transition-colors',
                                    validationError
                                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white',
                                )}
                            >
                                {validationError ? 'Fix errors' : 'Apply Changes'}
                            </button>
                            <button
                                onClick={() => {
                                    setDraftConfig({ ...liveConfig });
                                }}
                                className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium py-1.5 rounded transition-colors"
                            >
                                Revert
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Content ── */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="h-10 flex items-center justify-between px-5 border-b border-gray-700/50 shrink-0">
                        <span className="text-sm font-medium text-gray-200">
                            {CATEGORIES.find((c) => c.id === activeCategory)?.label}
                        </span>
                        <div className="flex items-center gap-2">
                            {isDirty && (
                                <span className="text-[11px] text-yellow-400 font-medium">
                                    Unsaved changes
                                </span>
                            )}
                            <button
                                onClick={handleClose}
                                className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-200 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">
                        {panels[activeCategory]}
                    </div>
                </div>
            </div>
        </div>
    );
};
