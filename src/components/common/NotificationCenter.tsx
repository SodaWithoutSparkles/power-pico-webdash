import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { Notification } from '../../store/storeTypes';

const TYPE_STYLES: Record<string, { border: string; bg: string; text: string }> = {
    info: { border: 'border-blue-500/80', bg: 'bg-blue-900/80', text: 'text-white' },
    success: { border: 'border-emerald-500/80', bg: 'bg-emerald-900/80', text: 'text-white' },
    warning: { border: 'border-amber-500/80', bg: 'bg-amber-900/80', text: 'text-white' },
    error: { border: 'border-red-500/80', bg: 'bg-red-900/80', text: 'text-white' }
};

/**
 * Unique key per notification instance — includes count so dedup bumps
 * cause the component to remount with a fresh dismiss timer.
 */
function notifKey(n: Notification): string {
    return n.id + '-' + (n.count ?? 0);
}

function getDismissDelay(n: Notification): number {
    return n.dismissDelay ?? n.timeout ?? (n.type === 'error' ? 8000 : 5000);
}

export const NotificationCenter: React.FC = () => {
    const notifications = useStore((state) => state.notifications);
    const removeNotification = useStore((state) => state.removeNotification);
    const timeoutsRef = useRef<Map<string, number>>(new Map());

    // Sort: higher priority first, then insertion order
    const sorted = useMemo(
        () => [...notifications].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
        [notifications],
    );

    const keys = useMemo(
        () => new Set(sorted.map((n) => notifKey(n))),
        [sorted],
    );

    useEffect(() => {
        sorted.forEach((n: Notification) => {
            const key = notifKey(n);
            if (timeoutsRef.current.has(key)) return;
            const delay = getDismissDelay(n);
            const timerId = window.setTimeout(() => {
                removeNotification(n.id);
            }, delay);
            timeoutsRef.current.set(key, timerId);
        });

        timeoutsRef.current.forEach((timerId, key) => {
            if (!keys.has(key)) {
                window.clearTimeout(timerId);
                timeoutsRef.current.delete(key);
            }
        });
    }, [sorted, keys, removeNotification]);

    if (sorted.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-[min(90vw,420px)]">
            {sorted.map((n: Notification) => {
                const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
                const showBadge = (n.count ?? 0) > 0;
                return (
                    <div
                        key={notifKey(n)}
                        className={`relative border ${style.border} ${style.bg} ${style.text} rounded-lg shadow-lg px-4 py-3 backdrop-blur overflow-hidden`}
                        role="status"
                        aria-live="polite"
                    >
                        {/* [xN] badge — bottom-right corner, no layout impact */}
                        {showBadge && (
                            <span className="absolute bottom-1 right-2 text-[9px] text-white/40 font-mono leading-none pointer-events-none select-none">
                                [x{n.count}]
                            </span>
                        )}

                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                                {n.title && (
                                    <div className="font-semibold text-sm mb-1 pr-6">
                                        {n.title}
                                    </div>
                                )}
                                <div className="text-sm leading-snug">
                                    {n.message}
                                </div>
                                {n.detail && (
                                    <div className="mt-1 text-xs text-white/90 break-words">
                                        {n.detail}
                                    </div>
                                )}
                                {n.actions && n.actions.length > 0 && (
                                    <div className="mt-2 flex gap-2 flex-wrap">
                                        {n.actions.map((a, i) => (
                                            <button
                                                key={i}
                                                onClick={() => { a.onClick(); removeNotification(n.id); }}
                                                className="px-2 py-0.5 text-[11px] font-medium bg-white/10 hover:bg-white/20 rounded transition-colors"
                                            >
                                                {a.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                className="text-white/80 hover:text-white text-sm shrink-0"
                                onClick={() => removeNotification(n.id)}
                                aria-label="Dismiss notification"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
