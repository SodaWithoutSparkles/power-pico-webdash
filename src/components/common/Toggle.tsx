import React from 'react';
import clsx from 'clsx';

interface ToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({ enabled, onChange, disabled }) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={disabled}
            onClick={() => onChange(!enabled)}
            className={clsx(
                'relative inline-flex h-5 w-10 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900',
                enabled ? 'bg-blue-600' : 'bg-gray-600',
                disabled && 'opacity-50 cursor-not-allowed',
            )}
        >
            <span
                aria-hidden="true"
                className={clsx(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
                    enabled ? 'translate-x-5' : 'translate-x-0',
                )}
            />
        </button>
    );
};
