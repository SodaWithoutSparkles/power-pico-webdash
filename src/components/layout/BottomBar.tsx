import React from 'react';
import { useScopeStore } from '../../store/scopeStore';
import clsx from 'clsx';

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

            <span className="text-gray-700">|</span>

            {/* Metrics */}
            <span className="tabular-nums">{status.pktPerSec} pkt/s</span>
            <span className="tabular-nums">{status.sampleCount} samples</span>
            <span className="tabular-nums">
                Buffer{' '}
                <span className={clsx(status.bufferFillPct > 0.9 && 'text-yellow-400')}>
                    {(status.bufferFillPct * 100).toFixed(0)}%
                </span>
            </span>

            <span className="text-gray-700">|</span>

            {/* Live values */}
            <span className="tabular-nums">
                V <span className="text-yellow-400">{status.liveV.toFixed(3)}</span>
            </span>
            <span className="tabular-nums">
                I <span className="text-cyan-400">{status.liveI.toFixed(3)}</span> A
            </span>
            <span className="tabular-nums">
                P <span className="text-fuchsia-400">{status.liveW.toFixed(3)}</span> W
            </span>

            <div className="ml-auto" />

            <span className="tabular-nums text-gray-600">
                TS {status.lastTimestampUs}
            </span>
        </div>
    );
};
