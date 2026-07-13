// Phase 5 — Scope header. Connect / Start / Pause. Simulate and Clear were
// moved out: Simulate removed, Clear relocated to the left toolbar (ScopeToolbar)
// and also available via the Range operations menu in ScopeView.

import { useScopeStore } from "../store/scopeStore";
import { createDebug } from "../utils/debug";
import { Play, Pause, Plug } from "lucide-react";

const log = createDebug("header");

export function ScopeHeader() {
    const running = useScopeStore((s) => s.running);
    const mode = useScopeStore((s) => s.mode);
    const connect = useScopeStore((s) => s.connect);
    const start = useScopeStore((s) => s.start);
    const pause = useScopeStore((s) => s.pause);

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
                    onClick={() => {
                        log("Start clicked, mode=%s running=%s", mode, running);
                        start();
                    }}
                    disabled={mode === "idle"}
                    title={mode === "idle" ? "Connect first" : "Start ingestion"}
                >
                    <Play size={16} /> Start
                </button>
            )}

            <div className="ml-auto text-xs text-gray-400 uppercase tracking-wider">
                {mode === "idle" ? "No source" : mode}
            </div>
        </header>
    );
}
