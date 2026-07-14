import React from 'react';

interface SettingsEntryProps {
    label: string;
    description?: string;
    children: React.ReactNode;
}

/** A single settings row: label + description on the left, control on the right. */
export const SettingsEntry: React.FC<SettingsEntryProps> = ({ label, description, children }) => {
    return (
        <div className="flex items-center justify-between gap-6 py-2.5">
            <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200">{label}</div>
                {description && (
                    <div className="text-[11px] text-gray-500 mt-0.5">{description}</div>
                )}
            </div>
            <div className="shrink-0">
                {children}
            </div>
        </div>
    );
};
