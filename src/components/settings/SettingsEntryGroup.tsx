import React from 'react';

interface SettingsEntryGroupProps {
    title: string;
    description?: string;
    children: React.ReactNode;
}

/** A titled group of settings entries with a separator. */
export const SettingsEntryGroup: React.FC<SettingsEntryGroupProps> = ({ title, description, children }) => {
    return (
        <div className="py-3 first:pt-0">
            <h3 className="text-sm font-semibold text-gray-200 mb-1">{title}</h3>
            {description && (
                <p className="text-xs text-gray-500 mb-3">{description}</p>
            )}
            <div className="divide-y divide-gray-700/40">
                {children}
            </div>
        </div>
    );
};
