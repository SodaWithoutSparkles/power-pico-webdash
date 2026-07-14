import React, { useState, useRef, useCallback } from 'react';
import { useScopeStore } from '../../store/scopeStore';
import { ChevronDown, ChevronRight } from 'lucide-react';

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen ?? false);
    return (
        <div className="border-b border-gray-700/50">
            <button
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-400 hover:text-gray-200 uppercase tracking-wider"
                onClick={() => setOpen(!open)}
            >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {title}
            </button>
            {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
        </div>
    );
}

/** Blur-validated number input for sidebar. */
function SidebarNumInput({
    value,
    onCommit,
    min,
    max,
}: {
    value: number;
    onCommit: (v: number) => void;
    min: number;
    max: number;
}) {
    const [text, setText] = useState(() => String(value));
    const [focused, setFocused] = useState(false);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    const handleBlur = useCallback(() => {
        setFocused(false);
        const raw = parseInt(text, 10);
        if (isNaN(raw)) { setText(String(value)); return; }
        const clamped = Math.max(min, Math.min(max, raw));
        commitRef.current(clamped);
        setText(String(clamped));
    }, [text, min, max, value]);

    if (!focused && text !== String(value)) {
        setText(String(value));
    }

    return (
        <input
            type="text"
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 font-mono"
        />
    );
}

export const RightSidebar: React.FC = () => {
    const config = useScopeStore((s) => s.config);
    const setConfig = useScopeStore((s) => s.setConfig);
    const status = useScopeStore((s) => s.status);
    const engineRef = useScopeStore((s) => s.engineRef);

    return (
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col text-gray-300 z-20 overflow-y-auto">
            {/* Buffer Settings */}
            <Section title="Buffers">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Avg size</label>
                    <SidebarNumInput
                        value={config.avgSize}
                        onCommit={(v) => { setConfig({ avgSize: v }); useScopeStore.getState().applyConfigToEngine(); }}
                        min={1}
                        max={1000}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Window</label>
                    <SidebarNumInput
                        value={config.windowSize}
                        onCommit={(v) => { setConfig({ windowSize: v }); useScopeStore.getState().applyConfigToEngine(); }}
                        min={10}
                        max={100000}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 w-20">Avg mode</label>
                    <select
                        value={config.avgMode}
                        onChange={(e) => { setConfig({ avgMode: e.target.value as "simple" | "lttb" }); useScopeStore.getState().applyConfigToEngine(); }}
                        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                    >
                        <option value="simple">Min-max-avg</option>
                        <option value="lttb">LTTB</option>
                    </select>
                </div>
            </Section>

            {/* T+0 */}
            <Section title="T+0">
                <button
                    onClick={() => engineRef?.setTZero(status.lastTimestampUs)}
                    className="w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
                >
                    Set T=0
                </button>
                <button
                    onClick={() => engineRef?.resetTZero()}
                    className="w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium"
                >
                    Reset T=0
                </button>
            </Section>

        </div>
    );
};
