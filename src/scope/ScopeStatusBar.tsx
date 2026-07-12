// Phase 5 — Bottom status bar. Run/Stop, pkt/s, sample count, buffer fill,
// last ts, live V/I/W. Reads throttled status from useScopeStore.

import { useScopeStore } from "../store/scopeStore";

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline gap-1.5">
            <span className="text-gray-500 text-xs uppercase tracking-wide">{label}</span>
            <span className="text-gray-200 text-sm font-mono">{value}</span>
        </div>
    );
}

export function ScopeStatusBar() {
    const running = useScopeStore((s) => s.running);
    const pktPerSec = useScopeStore((s) => s.pktPerSec);
    const sampleCount = useScopeStore((s) => s.sampleCount);
    const bufferFillPct = useScopeStore((s) => s.bufferFillPct);
    const lastTimestampUs = useScopeStore((s) => s.lastTimestampUs);
    const liveV = useScopeStore((s) => s.liveV);
    const liveI = useScopeStore((s) => s.liveI);
    const liveW = useScopeStore((s) => s.liveW);

    return (
        <footer className="flex items-center gap-5 px-3 py-1.5 bg-gray-800 border-t border-gray-700 text-gray-300">
            <div className="flex items-center gap-1.5">
                <span
                    className={`w-2.5 h-2.5 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-red-500"
                        }`}
                />
                <span className="text-sm font-medium">{running ? "Run" : "Stop"}</span>
            </div>

            <Stat label="pkt/s" value={pktPerSec.toFixed(1)} />
            <Stat label="samples" value={sampleCount.toLocaleString()} />
            <Stat label="buffer" value={`${bufferFillPct.toFixed(0)}%`} />
            <Stat
                label="last ts"
                value={lastTimestampUs > 0 ? `${(lastTimestampUs / 1e6).toFixed(3)}s` : "—"}
            />

            <div className="ml-auto flex items-center gap-4">
                <Stat label="V" value={`${liveV.toFixed(3)}`} />
                <Stat label="I" value={`${liveI.toFixed(3)}`} />
                <Stat label="W" value={`${liveW.toFixed(3)}`} />
            </div>
        </footer>
    );
}
