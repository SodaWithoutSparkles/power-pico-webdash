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
                    break;
                case "bucketed-data":
                    setLatestData(msg.payload);
                    break;
                case "window-data":
                    setLatestData(msg.payload);
                    break;
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

        return () => {
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
