import React, { useCallback } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import clsx from 'clsx';

function fmtTimestamp(us: number): string {
    const totalUs = Math.abs(Math.round(us));
    const h = Math.floor(totalUs / 3_600_000_000);
    const m = Math.floor((totalUs % 3_600_000_000) / 60_000_000);
    const s = Math.floor((totalUs % 60_000_000) / 1_000_000);
    const usFrac = totalUs % 1_000_000;
    const sign = us < 0 ? '-' : '';
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(usFrac).padStart(6, '0')}`;
}

export const BottomBar: React.FC = () => {
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);

    const toggleRunning = useCallback(() => {
        if (status.running) {
            engineRef?.pause();
        } else {
            engineRef?.start();
        }
    }, [status.running, engineRef]);

    return (
        <div className="h-7 bg-gray-900 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 gap-4 shrink-0">
            {/* Status LED — clickable to toggle run/pause */}
            <button
                onClick={toggleRunning}
                className="flex items-center gap-1.5 hover:text-gray-200 transition-colors"
                title={status.running ? 'Click to pause' : 'Click to start'}
            >
                <span
                    className={clsx(
                        'w-2 h-2 rounded-full',
                        status.running ? 'bg-green-500' : 'bg-red-500',
                    )}
                />
                <span className="font-medium">{status.running ? 'Run' : 'Paused'}</span>
            </button>

            {/* Mode badge */}
            <span
                className={clsx(
                    'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase',
                    status.mode === 'simulate' && 'bg-yellow-900/60 text-yellow-400',
                    status.mode === 'serial' && 'bg-green-900/60 text-green-400',
                    status.mode === 'idle' && 'bg-gray-800 text-gray-500',
                )}
            >
                {status.mode}
            </span>

            <span className="text-gray-700 w-1">|</span>

            {/* Metrics */}
            <span className="tabular-nums w-20 text-right">{status.samplesPerSec} smp/s</span>
            <span className="tabular-nums w-20 text-right">{status.observationCount} obs</span>
            <span className="tabular-nums">
                {(status.bufferFillPct * 100).toFixed(0)}% Buf
            </span>

            <div className="ml-auto" />

            <span className="tabular-nums text-gray-600">
                {fmtTimestamp(status.lastTimestampUs)}
            </span>
        </div>
    );
};
