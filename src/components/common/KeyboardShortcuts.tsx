import { useEffect } from 'react';
import { useScopeStore } from '../../store/scopeStore';

// Scope-native keyboard shortcuts. Kept for later UX expansion; wired to the
// scope store so it stays build-clean after the drawing code was removed.
export const KeyboardShortcuts = () => {
    const start = useScopeStore((s) => s.start);
    const pause = useScopeStore((s) => s.pause);
    const running = useScopeStore((s) => s.running);
    const clearRegion = useScopeStore((s) => s.clearRegion);
    const resetSessionIntegrators = useScopeStore((s) => s.resetSessionIntegrators);
    const setTZero = useScopeStore((s) => s.setTZero);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore when typing in a field.
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            // Esc — clear the drag-region selection.
            if (e.key === 'Escape') {
                clearRegion();
                return;
            }

            // Space — start / pause (no modifier).
            if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                if (running) pause();
                else start();
                return;
            }

            // R — reset session integrators.
            if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                resetSessionIntegrators();
                return;
            }

            // T — set T=0.
            if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                setTZero();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [start, pause, running, clearRegion, resetSessionIntegrators, setTZero]);

    return null;
};
