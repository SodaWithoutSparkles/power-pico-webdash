// React hook that manages the ScopeEngine lifecycle.
// Creates the engine on mount, runs a rAF loop for polling/hysteresis,
// and wires serial actions to the store.

import { useEffect, useRef, useCallback } from "react";
import { useScopeStore } from "../../store/scopeStore";
import { ScopeEngine } from "../ingest/ScopeEngine";
import {
    createHysteresisState,
    updateScaleDelta,
    type ScaleTier,
} from "../lib/hysteresis";

/**
 * Hook that owns the scope engine on the main thread.
 * Call returned actions from UI components.
 */
export function useScopeEngineManager() {
    const engineRef = useRef<ScopeEngine | null>(null);
    const serialAbortRef = useRef<{
        reader: ReadableStreamDefaultReader<Uint8Array>;
        port: SerialPort;
    } | null>(null);
    const hysteresisRef = useRef(createHysteresisState());
    const rafRef = useRef<number>(0);
    const lastDataTs = useRef(0);
    const frameCount = useRef(0);

    const setEngineRef = useScopeStore((s) => s.setEngineRef);
    const setStatus = useScopeStore((s) => s.setStatus);
    const setLatestData = useScopeStore((s) => s.setLatestData);
    const setSessionTotals = useScopeStore((s) => s.setSessionTotals);
    const setHysteresisTier = useScopeStore((s) => s.setHysteresisTier);

    // Helper: run an engine action then update the store
    const act = useCallback(
        (fn: (e: ScopeEngine) => void) => {
            const engine = engineRef.current;
            if (!engine) return;
            fn(engine);
            setStatus(engine.computeStatus());
        },
        [setStatus],
    );

    // ── Serial actions ──

    const connectSerial = useCallback(async () => {
        if (!("serial" in navigator)) {
            console.error("[scope] Web Serial not supported in this browser");
            return;
        }
        try {
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });

            const engine = engineRef.current;
            if (engine) {
                engine.start();
                engine.mode = "serial";
                setStatus(engine.computeStatus());
            }

            const reader = port.readable!.getReader();
            serialAbortRef.current = { reader, port };

            (async () => {
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done || !serialAbortRef.current) break;
                        if (!value) continue;
                        engineRef.current?.pushSerialData(value);
                    }
                } catch (err) {
                    console.error("[scope] Serial read error:", err);
                } finally {
                    try { reader.cancel(); } catch { /* ignore */ }
                    if (serialAbortRef.current?.reader === reader) {
                        serialAbortRef.current = null;
                    }
                }
            })();

            console.log("[scope] Serial connected");
        } catch (err) {
            console.error("[scope] Serial connect failed:", err);
        }
    }, [setStatus]);

    const disconnect = useCallback(async () => {
        const state = serialAbortRef.current;
        serialAbortRef.current = null;
        if (state) {
            try { await state.reader.cancel(); } catch { /* ignore */ }
            try { await state.port.close(); } catch { /* ignore */ }
        }
        act((e) => e.disconnect());
    }, [act]);

    // ── Bootstrap effect ──

    useEffect(() => {
        const engine = new ScopeEngine(1_000_000);
        engineRef.current = engine;
        setEngineRef(engine);
        hysteresisRef.current = createHysteresisState();

        // Wire serial actions into the store
        const prevConnect = useScopeStore.getState().connectSerial;
        const prevDisconnect = useScopeStore.getState().disconnectSerial;
        useScopeStore.setState({ connectSerial, disconnectSerial: disconnect });

        // ── rAF render loop ──
        // Updates status every frame, fetches data ~30 fps, session ~2 fps.

        let prevTotalSamples = 0;
        let stallWarned = false;
        let lastRafTs = performance.now();

        function tick(now: number) {
            const deltaMs = now - lastRafTs;
            lastRafTs = now;
            frameCount.current++;

            // 1. Update status every frame
            const status = engine.computeStatus();
            setStatus(status);

            // Clear graph when buffer is cleared
            if (status.sampleCount === 0) {
                setLatestData(null);
            }

            // 2. Fetch bucketed data (~30 fps)
            if (status.running && engine.ring.length > 0) {
                const dataTs = now - lastDataTs.current;
                if (dataTs >= 33 || lastDataTs.current === 0) {
                    // ~30 fps data refresh
                    lastDataTs.current = now;
                    const t0 = performance.now();
                    const data = engine.getLatestWindow(200);
                    const t1 = performance.now();

                    setLatestData(data);

                    // Stall detection
                    if (prevTotalSamples > 0) {
                        const newSamples = status.sampleCount - prevTotalSamples;
                        if (newSamples > 1000 && !stallWarned) {
                            console.warn(
                                "[perf] ⚠ " + newSamples + " new samples — render may be falling behind",
                            );
                            stallWarned = true;
                        } else if (newSamples < 100) {
                            stallWarned = false;
                        }
                    }
                    prevTotalSamples = status.sampleCount;

                    // 3. Hysteresis: feed the peak current from the window into the Schmitt trigger
                    if (data.timestamps.length > 0) {
                        // Use maxI across the latest window as the peak
                        let peak = 0;
                        for (let i = 0; i < data.maxI.length; i++) {
                            if (data.maxI[i] > peak) peak = data.maxI[i];
                        }
                        hysteresisRef.current = updateScaleDelta(
                            hysteresisRef.current,
                            peak,
                            deltaMs,
                        );
                        setHysteresisTier(hysteresisRef.current.tier);
                    }

                    console.log(
                        "[perf] engine latestWindow=200" +
                        " bucketTime=" + (t1 - t0).toFixed(1) + "ms" +
                        " points=" + data.timestamps.length,
                    );
                }
            } else {
                // Not running — reset hysteresis to default
                hysteresisRef.current = createHysteresisState();
                setHysteresisTier("ma" as ScaleTier);
                lastDataTs.current = 0;
                prevTotalSamples = 0;
            }

            // 4. Session totals (~2 fps)
            if (frameCount.current % 30 === 0) {
                setSessionTotals(engine.getSessionTotals());
            }

            rafRef.current = requestAnimationFrame(tick);
        }

        rafRef.current = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
            engine.stopSimulate();
            engineRef.current = null;
            setEngineRef(null);
            useScopeStore.setState({
                connectSerial: prevConnect,
                disconnectSerial: prevDisconnect,
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setEngineRef, setStatus, setLatestData, setSessionTotals, setHysteresisTier]);

    return {
        start: () => act((e) => e.start()),
        pause: () => act((e) => e.pause()),
        clear: () => act((e) => e.clear()),
        startSimulate: () => act((e) => e.startSimulate()),
        stopSimulate: () => act((e) => e.stopSimulate()),
        connectSerial,
        disconnect,
    };
}
