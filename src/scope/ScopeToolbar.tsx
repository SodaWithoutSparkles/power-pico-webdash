// Phase 5 — Left toolbar. Channel visibility toggles + T+0 reset.
// ponytail: just buttons; no dropdown menus needed.

import { useScopeStore } from "../store/scopeStore";
import { Zap, Activity, Gauge, Clock } from "lucide-react";

const CHANNELS = [
    { key: "v" as const, label: "Voltage", icon: Zap, color: "text-cyan-400" },
    { key: "i" as const, label: "Current", icon: Activity, color: "text-amber-400" },
    { key: "w" as const, label: "Power", icon: Gauge, color: "text-violet-400" },
];

export function ScopeToolbar() {
    const channels = useScopeStore((s) => s.config.channels);
    const setConfig = useScopeStore((s) => s.setConfig);
    const setTZero = useScopeStore((s) => s.setTZero);

    return (
        <div className="w-12 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-2 space-y-1 z-20">
            {CHANNELS.map(({ key, label, icon: Icon, color }) => {
                const on = channels[key];
                return (
                    <button
                        key={key}
                        onClick={() => setConfig({ channels: { ...channels, [key]: !on } })}
                        className={`p-2 rounded transition-colors relative group ${on ? `${color} bg-gray-700` : "text-gray-500 hover:bg-gray-700"
                            }`}
                        title={`${on ? "Hide" : "Show"} ${label}`}
                        aria-pressed={on}
                    >
                        <Icon size={20} />
                        {on && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
                        )}
                    </button>
                );
            })}

            <div className="w-8 h-px bg-gray-600 my-2" />

            <button
                onClick={setTZero}
                className="p-2 rounded text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
                title="Set current time as T=0"
            >
                <Clock size={20} />
            </button>
        </div>
    );
}
