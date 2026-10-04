import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface BlurInputProps {
    value: number;
    onCommit: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    display?: (v: number) => string;
    parse?: (s: string) => number;
    extraValidate?: (v: number) => number;
}

/** Text input that commits on blur. Validates, clamps, and formats. */
export const BlurInput: React.FC<BlurInputProps> = ({
    value, onCommit, min, max, step, className, display, parse, extraValidate,
}) => {
    const [text, setText] = useState(() => (display ? display(value) : String(value)));
    const [focused, setFocused] = useState(false);
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;

    const fmt = useMemo(() => display ? display(value) : String(value), [value, display]);

    // Sync from store when not focused
    useEffect(() => {
        if (!focused && text !== fmt) {
            setText(fmt);
        }
    }, [fmt, focused]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleBlur = useCallback(() => {
        setFocused(false);
        const raw = parse ? parse(text) : Number(text);
        if (isNaN(raw)) { setText(fmt); return; }
        let clamped = extraValidate ? extraValidate(raw) : raw;
        if (min !== undefined) clamped = Math.max(min, clamped);
        if (max !== undefined) clamped = Math.min(max, clamped);
        commitRef.current(clamped);
        setText(display ? display(clamped) : String(clamped));
    }, [text, min, max, display, fmt, parse, extraValidate]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
    }, []);

    const handleFocus = useCallback(() => setFocused(true), []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
        }
    }, []);

    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            step={step}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className={className ?? "w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 text-right font-mono focus:outline-none focus:border-blue-500"}
        />
    );
};
