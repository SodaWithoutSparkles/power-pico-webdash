import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface PopupPanelProps {
    open: boolean;
    onClose: () => void;
    title: string;
    icon?: ReactNode;  // optional icon next to title
    children: ReactNode;
}

export function PopupPanel({ open, onClose, title, icon, children }: PopupPanelProps) {
    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={onClose}
        >
            <div
                className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl flex flex-col text-gray-300 overflow-hidden"
                style={{ width: "75vw", height: "90vh" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title bar */}
                <div className="bg-gray-900 px-4 py-2 text-sm font-semibold uppercase tracking-wider flex items-center justify-between shrink-0">
                    <span className="flex items-center gap-2">
                        {icon}
                        {title}
                    </span>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-200" title="Close">
                        <X size={18} />
                    </button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}
