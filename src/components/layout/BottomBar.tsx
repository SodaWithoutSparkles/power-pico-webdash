import React from 'react';
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

    return (
        <div className="h-7 bg-gray-900 border-t border-gray-700 flex items-center px-3 text-xs text-gray-400 gap-4 shrink-0">
            {/* Status LED */}
            <div className="flex items-center gap-1.5">
                <span
                    className={clsx(
                        'w-2 h-2 rounded-full',
                        status.running ? 'bg-green-500' : 'bg-red-500',
                    )}
                />
                <span className="font-medium">{status.running ? 'Run' : 'Paused'}</span>
            </div>

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
            <div className="flex items-center gap-1.5">
                <div className="relative w-20 h-3.5 bg-gray-800 rounded-sm overflow-hidden">
                    <div
                        className={clsx(
                            'absolute top-0 right-0 h-full transition-all duration-200',
                            status.bufferFillPct > 0.9 ? 'bg-yellow-600' : 'bg-blue-600',
                        )}
                        style={{ width: `${Math.min(100, status.bufferFillPct * 100)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white/90 leading-none">
                        {(status.bufferFillPct * 100).toFixed(0)}%
                    </span>
                </div>
            </div>

            <div className="ml-auto" />

            <span className="tabular-nums text-gray-600">
                {fmtTimestamp(status.lastTimestampUs)}
            </span>
        </div>
    );
};
