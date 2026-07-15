// React hook that manages the ScopeEngine lifecycle.
// Creates the engine on mount, runs a rAF loop for polling,
// and wires serial actions to the store.

import { useEffect, useRef, useCallback } from "react";
import { useScopeStore } from "../../store/scopeStore";
import { ScopeEngine } from "../ingest/ScopeEngine";
import { useStore } from "../../store/useStore";
import {
    DATA_REFRESH_MS,
    SESSION_TOTALS_INTERVAL,
    DEBUG_LOG_INTERVAL,
    STALL_WARN_THRESHOLD,
    STALL_RESET_THRESHOLD,
    INITIAL_BUCKET_COUNT,
    SERIAL_BAUD_RATE,
    SERIAL_LOG_INTERVAL_MS,
} from "../constants";

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
    const rafRef = useRef<number>(0);
    const lastDataTs = useRef(0);
    const frameCount = useRef(0);
    const bucketCountRef = useRef(INITIAL_BUCKET_COUNT);

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
            await port.open({ baudRate: SERIAL_BAUD_RATE });

            const engine = engineRef.current;
            if (engine) {
                engine.start();
                engine.mode = "serial";
                setStatus(engine.computeStatus());
            }

            const reader = port.readable!.getReader();
            serialAbortRef.current = { reader, port };

            let bytesRead = 0;
            let lastLogTs = performance.now();
            (async () => {
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done || !serialAbortRef.current) break;
                        if (!value) continue;
                        bytesRead += value.length;
                        const now = performance.now();
                        if (now - lastLogTs > SERIAL_LOG_INTERVAL_MS) {
                            console.log('[scope] Serial reader: ' + bytesRead + ' bytes read, ' + (bytesRead / ((now - lastLogTs) / 1000)).toFixed(0) + ' B/s, engine sampleCount=' + (engineRef.current?.sampleCount ?? 0));
                            lastLogTs = now;
                            bytesRead = 0;
                        }
                        try {
                            engineRef.current?.pushSerialData(value);
                        } catch (err) {
                            console.error("[scope] Error processing serial data:", err);
                        }
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
        const cfg = useScopeStore.getState().config;
        const engine = new ScopeEngine(cfg.ringCapacity);
        engine.expectedSamplesPerPacket = cfg.expectedSamplesPerPacket;
        engine.packetSmoothing = cfg.packetSmoothing;
        engine.sampleIntervalUs = 1_000_000 / cfg.nominalSampleRate;
        engine.onPacketWarning = (msg) => {
            useStore.getState().addNotification({ type: 'error', title: 'Packet Warning', message: msg });
        };
        engineRef.current = engine;
        setEngineRef(engine);
        console.log('[scope] Engine created, capacity=' + engine.ring.capacity + ' mode=' + engine.mode);

        // Apply initial config to engine
        useScopeStore.getState().applyConfigToEngine();

        // Wire serial actions into the store
        const prevConnect = useScopeStore.getState().connectSerial;
        const prevDisconnect = useScopeStore.getState().disconnectSerial;
        useScopeStore.setState({ connectSerial, disconnectSerial: disconnect });

        // Sync bucketCount ref on resize (avoid reading store every frame)
        const unsub = useScopeStore.subscribe((state, prev) => {
            if (state.bucketCount !== prev.bucketCount) {
                bucketCountRef.current = state.bucketCount;
            }
        });

        // ── rAF render loop ──
        // Updates status every frame, fetches data ~30 fps, session ~2 fps.

        let prevTotalSamples = 0;
        let stallWarned = false;

        let debugLogInterval = 0;

        function tick(now: number) {
            frameCount.current++;

            // 1. Update status every frame
            const status = engine.computeStatus();
            setStatus(status);

            // Clear graph when buffer is cleared
            if (status.observationCount === 0) {
                setLatestData(null);
            }

            // 2. Fetch bucketed data (~30 fps) — runs even when paused so the graph stays alive
            if (engine.ring.length > 0) {
                const dataTs = now - lastDataTs.current;
                if (dataTs >= DATA_REFRESH_MS || lastDataTs.current === 0) {
                    // ~30 fps data refresh — engine.getLatestWindow also updates hysteresis internally
                    lastDataTs.current = now;
                    const data = engine.getLatestWindow(bucketCountRef.current);

                    setLatestData(data);
                    setHysteresisTier(engine.scaleTier);

                    // Stall detection
                    if (prevTotalSamples > 0) {
                        const newSamples = status.observationCount - prevTotalSamples;
                        if (newSamples > STALL_WARN_THRESHOLD && !stallWarned) {
                            console.warn(
                                "[perf] ⚠ " + newSamples + " new observations — render may be falling behind",
                            );
                            stallWarned = true;
                        } else if (newSamples < STALL_RESET_THRESHOLD) {
                            stallWarned = false;
                        }
                    }
                    prevTotalSamples = status.observationCount;
                }
            } else {
                // Not running — reset engine hysteresis
                engine.resetHysteresis();
                setHysteresisTier(engine.scaleTier);
                lastDataTs.current = 0;
                prevTotalSamples = 0;
            }

            // 3. Session totals (~2 fps)
            if (frameCount.current % SESSION_TOTALS_INTERVAL === 0) {
                setSessionTotals(engine.getSessionTotals());
            }

            // 4. Periodic debug log (~1 Hz)
            debugLogInterval++;
            if (debugLogInterval % DEBUG_LOG_INTERVAL === 0) {
                const st = engine.computeStatus();
                console.log(
                    '[scope] tick mode=' + st.mode +
                    ' running=' + st.running +
                    ' obs=' + st.observationCount +
                    ' fill=' + (st.bufferFillPct * 100).toFixed(1) + '%' +
                    ' smp/s=' + st.samplesPerSec +
                    ' ring.len=' + engine.ring.length +
                    ' display.len=' + (engine.displayLength ?? 0) +
                    ' lastDataTs=' + (lastDataTs.current > 0 ? (now - lastDataTs.current).toFixed(0) + 'ms ago' : 'never')
                );
            }

            rafRef.current = requestAnimationFrame(tick);
        }

        rafRef.current = requestAnimationFrame(tick);

        return () => {
            unsub();
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
