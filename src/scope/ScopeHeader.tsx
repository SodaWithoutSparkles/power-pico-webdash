// Phase 5 — Scope header. Connect / Simulate / Start / Pause / Clear / T+0.
// Reads/writes useScopeStore. No drawing-store coupling.

import { useScopeStore } from "../store/scopeStore";
import { Play, Pause, Trash2, Plug, FlaskConical, Clock } from "lucide-react";

export function ScopeHeader() {
    const running = useScopeStore((s) => s.running);
    const mode = useScopeStore((s) => s.mode);
    const connect = useScopeStore((s) => s.connect);
    const simulate = useScopeStore((s) => s.simulate);
    const start = useScopeStore((s) => s.start);
    const pause = useScopeStore((s) => s.pause);
    const clear = useScopeStore((s) => s.clear);
    const setTZero = useScopeStore((s) => s.setTZero);

    const btn =
        "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors";

    return (
        <header className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-b border-gray-700 text-gray-200">
            <span className="font-semibold text-cyan-400 mr-2">Power Pico Scope</span>

            <button
                className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
                onClick={connect}
                title="Connect to a serial port (Web Serial)"
            >
                <Plug size={16} /> Connect
            </button>

            <button
                className={`${btn} bg-violet-600 hover:bg-violet-500 text-white`}
                onClick={simulate}
                title="Generate synthetic data (no hardware)"
            >
                <FlaskConical size={16} /> Simulate
            </button>

            <div className="w-px h-6 bg-gray-600 mx-1" />

            {running ? (
                <button
                    className={`${btn} bg-amber-600 hover:bg-amber-500 text-white`}
                    onClick={pause}
                    title="Pause ingestion"
                >
                    <Pause size={16} /> Pause
                </button>
            ) : (
                <button
                    className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
                    onClick={start}
                    disabled={mode === "idle"}
                    title={mode === "idle" ? "Connect or Simulate first" : "Start ingestion"}
                >
                    <Play size={16} /> Start
                </button>
            )}

            <button
                className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`}
                onClick={clear}
                title="Clear buffers and integrators"
            >
                <Trash2 size={16} /> Clear
            </button>

            <button
                className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`}
                onClick={setTZero}
                title="Set current time as T=0"
            >
                <Clock size={16} /> Set T=0
            </button>

            <div className="ml-auto text-xs text-gray-400 uppercase tracking-wider">
                {mode === "idle" ? "No source" : mode}
            </div>
        </header>
    );
}
