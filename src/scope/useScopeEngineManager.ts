// React hook that manages the Web Worker lifecycle.
// Creates the worker, dispatches messages, and routes responses to the scope store.

import { useEffect, useRef, useCallback } from "react";
import { useScopeStore } from "../store/scopeStore";
import type { WorkerRequest, WorkerResponse } from "./workerTypes";

/**
 * Hook that owns the scope worker.
 * Call returned actions from UI components.
 */
export function useScopeEngineManager() {
    const workerRef = useRef<Worker | null>(null);
    const setWorkerRef = useScopeStore((s) => s.setWorkerRef);
    const setStatus = useScopeStore((s) => s.setStatus);
    const setLatestData = useScopeStore((s) => s.setLatestData);

    useEffect(() => {
        // Create the worker
        const worker = new Worker(
            new URL("./scope.worker.ts", import.meta.url),
            { type: "module" },
        );

        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const msg = e.data;
            switch (msg.type) {
                case "status":
                    setStatus(msg.payload);
                    // When ring buffer is cleared (sampleCount hits 0), also clear the graph
                    if (msg.payload.sampleCount === 0) {
                        setLatestData(null);
                    }
                    break;
                case "bucketed-data": {
                    const t5 = performance.now();
                    const req = (msg as any)._req || {};
                    const roundTrip = t5 - (req._t0 ?? t5);
                    console.log(
                        "[perf] bucketed-data roundTrip=" + roundTrip.toFixed(1) + "ms" +
                        " buckets=" + msg.payload.timestamps.length
                    );
                    setLatestData(msg.payload);
                    break;
                }
                case "window-data": {
                    const t5 = performance.now();
                    const req = (msg as any)._req || {};
                    const roundTrip = t5 - (req._t0 ?? t5);
                    const n = msg.payload.timestamps.length;
                    console.log(
                        "[perf] window-data roundTrip=" + roundTrip.toFixed(1) + "ms" +
                        " buckets=" + n +
                        " pollInterval=" + (pollTimestamps.length > 0 ? (t5 - pollTimestamps[pollTimestamps.length - 1]).toFixed(0) : "-") + "ms"
                    );
                    pollTimestamps.push(t5);
                    if (pollTimestamps.length > 100) pollTimestamps.shift();
                    // Warn if ring buffer is growing faster than we can consume
                    const st = useScopeStore.getState().status;
                    if (prevTotalSamples > 0) {
                        const newSamples = st.sampleCount - prevTotalSamples;
                        if (newSamples > 1000 && !stallWarned) {
                            console.warn("[perf] ⚠ " + newSamples + " new samples since last poll — render may be falling behind");
                            stallWarned = true;
                        } else if (newSamples < 100) {
                            stallWarned = false;
                        }
                    }
                    prevTotalSamples = st.sampleCount;
                    setLatestData(msg.payload);
                    break;
                }
                case "frac":
                    // Frac is used by cursor positioning — store not needed for debug panel
                    break;
                case "integration-result":
                    useScopeStore.getState().setSelection(msg.payload);
                    break;
                case "error":
                    console.error("[scope worker]", msg.message);
                    break;
            }
        };

        worker.onerror = (err) => {
            console.error("[scope worker error]", err);
        };

        // Initialize
        worker.postMessage({
            type: "init",
            config: { baudRate: 115200, capacity: 1_000_000 },
        } satisfies WorkerRequest);

        workerRef.current = worker;
        setWorkerRef(worker);

        // Poll for bucketed data when running
        // Fewer buckets = less worker compute + less transfer + faster uPlot render
        // 80ms interval gives ~12 updates/s for smooth animation
        let pollId = 0;
        const pollInterval = setInterval(() => {
            const state = useScopeStore.getState();
            if (state.status.running && workerRef.current) {
                const id = ++pollId;
                const t0 = performance.now();
                workerRef.current.postMessage({
                    type: "get-data-window",
                    fromFraction: 0,
                    toFraction: 1,
                    bucketCount: 100,
                    _pollId: id,
                    _t0: t0,
                } as WorkerRequest);
            }
        }, 80);

        // Track cumulative poll stats
        let prevTotalSamples = 0;
        let stallWarned = false;
        const pollTimestamps: number[] = [];

        return () => {
            clearInterval(pollInterval);
            worker.terminate();
            workerRef.current = null;
            setWorkerRef(null);
        };
    }, [setWorkerRef, setStatus, setLatestData]);

    const post = useCallback((msg: WorkerRequest) => {
        workerRef.current?.postMessage(msg);
    }, []);

    return {
        start: () => post({ type: "start" }),
        pause: () => post({ type: "pause" }),
        clear: () => post({ type: "clear" }),
        startSimulate: () => post({ type: "start-simulate" }),
        stopSimulate: () => post({ type: "stop-simulate" }),
        connectSerial: () => post({ type: "connect-serial" }),
        disconnect: () => post({ type: "disconnect" }),
    };
}
