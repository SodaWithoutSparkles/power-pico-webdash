import React, { useCallback } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { useStore } from '../../store/useStore';
import { Zap, Activity, Gauge, Plug, Play, Pause, Timer } from 'lucide-react';
import clsx from 'clsx';

export const LeftSidebar: React.FC = () => {
    const channels = useScopeStore((s) => s.config.channels);
    const setConfig = useScopeStore((s) => s.setConfig);
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);
    const tZeroSet = useScopeStore((s) => s.tZeroSet);
    const setTZeroSet = useScopeStore((s) => s.setTZeroSet);
    const connectSerial = useScopeStore((s) => s.connectSerial);
    const disconnectSerial = useScopeStore((s) => s.disconnectSerial);

    const toggleChannel = (ch: 'v' | 'i' | 'w') => {
        setConfig({ channels: { ...channels, [ch]: !channels[ch] } });
    };

    const handleTZero = () => {
        if (tZeroSet) {
            engineRef?.resetTZero();
            setTZeroSet(false);
        } else {
            engineRef?.setTZero(status.lastTimestampUs);
            setTZeroSet(true);
        }
    };

    const toggleRunning = useCallback(() => {
        if (status.running) {
            engineRef?.pause();
            return;
        }
        // Refuse to start when no source is connected
        if (status.mode === 'idle') {
            useStore.getState().addNotification({
                type: 'warning',
                title: 'No source',
                message: 'Connect a serial device or start simulation first.',
                id: 'no-source-warning',
                dismissDelay: 4000,
            });
            return;
        }
        engineRef?.start();
    }, [status.running, status.mode, engineRef]);

    const buttons = [
        { id: 'v' as const, icon: Zap, label: 'Voltage', color: 'text-yellow-400' },
        { id: 'i' as const, icon: Activity, label: 'Current', color: 'text-cyan-400' },
        { id: 'w' as const, icon: Gauge, label: 'Power', color: 'text-fuchsia-400' },
    ];

    const isSerial = status.mode === 'serial';

    return (
        <div className="w-12 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-2 space-y-1 z-20">
            {buttons.map((btn) => (
                <div key={btn.id} className="relative w-full flex justify-center">
                    <button
                        onClick={() => toggleChannel(btn.id)}
                        className={clsx(
                            'p-2 rounded hover:bg-gray-700 transition-colors',
                            channels[btn.id] ? btn.color : 'text-gray-600',
                        )}
                        title={`${btn.label} (${channels[btn.id] ? 'on' : 'off'})`}
                    >
                        <btn.icon size={20} />
                    </button>
                </div>
            ))}

            <div className="w-8 h-px bg-gray-700 my-2" />

            {/* Play / Pause */}
            <div className="relative w-full flex justify-center">
                <button
                    onClick={toggleRunning}
                    className={clsx(
                        'p-2 rounded hover:bg-gray-700 transition-colors',
                        status.running ? 'text-red-400' : 'text-green-500',
                    )}
                    title={status.running ? 'Pause' : 'Start'}
                >
                    {status.running ? <Pause size={20} /> : <Play size={20} />}
                </button>
            </div>

            {/* T+0 toggle */}
            <div className="relative w-full flex justify-center">
                <button
                    onClick={handleTZero}
                    className={clsx(
                        'p-2 rounded hover:bg-gray-700 transition-colors',
                        tZeroSet ? 'text-yellow-400' : 'text-gray-500',
                    )}
                    title={tZeroSet ? 'Reset T+0' : 'Set T+0'}
                >
                    <Timer size={20} />
                </button>
            </div>

            <div className="w-8 h-px bg-gray-700 my-2" />

            {/* Serial connect */}
            <div className="relative w-full flex justify-center">
                <button
                    onClick={isSerial ? disconnectSerial : connectSerial}
                    className={clsx(
                        'p-2 rounded hover:bg-gray-700 transition-colors',
                        isSerial ? 'text-green-400' : 'text-gray-500',
                    )}
                    title={isSerial ? 'Disconnect Serial' : 'Connect Serial'}
                >
                    <Plug size={20} />
                </button>
            </div>
        </div>
    );
};
