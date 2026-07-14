// Minimal verification UI for the scope engine.
// Shows text readouts — no graph. Temporary; replaced in Phase C.

import React, { useCallback } from "react";
import { useScopeStore } from "../../store/scopeStore";
import clsx from "clsx";

export const ScopeDebugPanel: React.FC = () => {
    const status = useScopeStore((s) => s.status);
    const latestData = useScopeStore((s) => s.latestData);
    const engineRef = useScopeStore((s) => s.engineRef);
    const connectSerial = useScopeStore((s) => s.connectSerial);
    const disconnectSerial = useScopeStore((s) => s.disconnectSerial);
    const setStatus = useScopeStore((s) => s.setStatus);

    const act = useCallback(
        (fn: (e: import("../ingest/ScopeEngine").ScopeEngine) => void) => {
            const e = engineRef;
            if (!e) return;
            fn(e);
            setStatus(e.computeStatus());
        },
        [engineRef, setStatus],
    );

    const isRunning = status.running;
    const mode = status.mode;

    const statusBadge = () => {
        if (mode === "simulate") return { label: "SIM", color: "bg-yellow-500" };
        if (mode === "serial") return { label: "SERIAL", color: "bg-green-500" };
        if (isRunning) return { label: "RUN", color: "bg-green-500" };
        return { label: "IDLE", color: "bg-gray-500" };
    };

    const badge = statusBadge();

    return (
        <div className="h-full w-full flex items-center justify-center bg-gray-900 p-8">
            <div className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl p-8 max-w-lg w-full">
                <h2 className="text-xl font-bold text-white mb-6 text-center">
                    Scope Engine — Debug Panel
                </h2>

                {/* Status badge */}
                <div className="flex items-center justify-center gap-3 mb-6">
                    <span className={clsx("w-3 h-3 rounded-full", badge.color)} />
                    <span className="text-white font-mono text-sm">{badge.label}</span>
                    {isRunning && <span className="text-green-400 text-sm">● Running</span>}
                    {!isRunning && <span className="text-gray-400 text-sm">● Paused</span>}
                </div>

                {/* Readouts */}
                <div className="space-y-2 font-mono text-sm">
                    <Row label="Buffer" value={`${(status.bufferFillPct * 100).toFixed(1)}% full (${status.observationCount} obs)`} />
                    <Row label="Sample rate" value={`${status.samplesPerSec} smp/s`} />
                    <Row label="Live V" value={`${status.liveV.toFixed(3)} V`} />
                    <Row label="Live I" value={`${status.liveI.toFixed(6)} A`} />
                    <Row label="Live P" value={`${status.liveW.toFixed(3)} W`} />
                    <Row label="Last TS" value={`${status.lastTimestampUs} µs`} />
                    {latestData && (
                        <Row label="Buckets" value={`${latestData.timestamps.length} pts`} />
                    )}
                </div>

                {/* Buttons */}
                <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    <button
                        onClick={() => act((e) => e.startSimulate())}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded text-sm font-medium transition-colors"
                    >
                        Simulate
                    </button>
                    {isRunning ? (
                        <button
                            onClick={() => act((e) => e.pause())}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium transition-colors"
                        >
                            Pause
                        </button>
                    ) : (
                        <button
                            onClick={() => act((e) => e.start())}
                            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
                        >
                            Start
                        </button>
                    )}
                    <button
                        onClick={() => act((e) => e.clear())}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm font-medium transition-colors"
                    >
                        Clear
                    </button>
                </div>

                {/* Serial button */}
                <div className="mt-3 flex justify-center">
                    {mode === "serial" ? (
                        <button
                            onClick={disconnectSerial}
                            className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
                        >
                            Disconnect Serial
                        </button>
                    ) : (
                        <button
                            onClick={connectSerial}
                            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-sm font-medium transition-colors"
                        >
                            Connect Serial
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-gray-400">{label}</span>
            <span className="text-white">{value}</span>
        </div>
    );
}
