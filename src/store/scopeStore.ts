// Phase 3 — Scope store (zustand). Owns the single ScopeEngine instance and is
// the sole UI API. Mirrors engine status (throttled) + holds config, T+0, and
// the two integrator tiers (session + drag-region). No drawing-store coupling.

import { create } from "zustand";
import { ScopeEngine } from "../scope/ScopeEngine";
import type { ScopeConfig, ScopeStatus } from "../scope/engineTypes";
import { createDebug } from "../utils/debug";

const log = createDebug("store");

// ponytail: one engine for the whole app. No need for context/provider.
const engine = new ScopeEngine();

const DEFAULT_CONFIG: ScopeConfig = {
    baudRate: 115200,
    avgSize: 10,
    windowSize: 1000,
    channels: { v: true, i: true, w: true },
    vScale: { auto: true, min: 0, max: 0 },
    hZoomSec: 0,
};

// Throttle status → React to ~10 Hz so high pkt rates don't thrash renders.
const STATUS_THROTTLE_MS = 100;

export type NotificationType = "info" | "success" | "warning" | "error";

export interface ScopeNotification {
    id: string;
    type: NotificationType;
    title?: string;
    message: string;
    detail?: string;
    timeout?: number;
}

export interface RegionSelection {
    tStartUs: number; // display-time (us) of drag start
    tEndUs: number; // display-time (us) of drag end
    energyJ: number;
    chargeC: number;
}

export interface ScopeStoreState {
    // config
    config: ScopeConfig;
    setConfig: (patch: Partial<ScopeConfig>) => void;

    // status (mirrored from engine, throttled)
    running: boolean;
    mode: ScopeStatus["mode"];
    pktPerSec: number;
    sampleCount: number;
    bufferFillPct: number;
    lastTimestampUs: number;
    liveV: number;
    liveI: number;
    liveW: number;
    sessionEnergyJ: number;
    sessionChargeC: number;
    tZeroOffsetUs: number;

    // T+0
    setTZero: () => void;
    resetTZero: () => void;

    // session integrators
    resetSessionIntegrators: () => void;

    // region (drag selection on chart)
    region: RegionSelection | null;
    setRegion: (tStartUs: number, tEndUs: number) => void;
    clearRegion: () => void;

    // notifications (engine errors + lifecycle toasts)
    notifications: ScopeNotification[];
    notify: (n: Omit<ScopeNotification, "id">) => void;
    dismissNotification: (id: string) => void;

    // lifecycle
    connect: () => Promise<void>;
    simulate: () => void;
    start: () => void;
    pause: () => void;
    clear: () => void;
    disconnect: () => Promise<void>;

    // engine access for the render loop (snapshot)
    getEngine: () => ScopeEngine;
}

let lastStatusPush = 0;

export const useScopeStore = create<ScopeStoreState>((set, get) => {
    engine.onStatus((s: ScopeStatus) => {
        const now = performance.now();
        // Critical state (running/mode) must propagate immediately — never let
        // the throttle drop a start/pause/connect transition.
        const st = get();
        const criticalChanged = st.running !== s.running || st.mode !== s.mode;
        if (!criticalChanged && now - lastStatusPush < STATUS_THROTTLE_MS) return;
        lastStatusPush = now;
        set({
            running: s.running,
            mode: s.mode,
            pktPerSec: s.pktPerSec,
            sampleCount: s.sampleCount,
            bufferFillPct: s.bufferFillPct,
            lastTimestampUs: s.lastTimestampUs,
            liveV: s.liveV,
            liveI: s.liveI,
            liveW: s.liveW,
            sessionEnergyJ: s.sessionEnergyJ,
            sessionChargeC: s.sessionChargeC,
            tZeroOffsetUs: s.tZeroOffsetUs,
        });
    });

    engine.onError((e: Error) => {
        get().notify({ type: "error", title: "Scope error", message: e.message });
    });

    return {
        config: { ...DEFAULT_CONFIG },

        setConfig: (patch) => {
            const next = { ...get().config, ...patch };
            engine.setConfig(patch);
            set({ config: next });
        },

        running: false,
        mode: "idle",
        pktPerSec: 0,
        sampleCount: 0,
        bufferFillPct: 0,
        lastTimestampUs: 0,
        liveV: 0,
        liveI: 0,
        liveW: 0,
        sessionEnergyJ: 0,
        sessionChargeC: 0,
        tZeroOffsetUs: 0,

        setTZero: () => {
            log("setTZero() invoked");
            engine.markTZero();
            log("setTZero() done, tZeroOffsetUs=%s", get().tZeroOffsetUs);
        },
        resetTZero: () => {
            log("resetTZero() invoked");
            engine.resetTZero();
        },

        resetSessionIntegrators: () => engine.resetSessionIntegrators(),

        region: null,
        setRegion: (tStartUs, tEndUs) => {
            log("setRegion() invoked tStartUs=%s tEndUs=%s", tStartUs, tEndUs);
            const { energyJ, chargeC } = engine.computeRegion(tStartUs, tEndUs);
            set({ region: { tStartUs, tEndUs, energyJ, chargeC } });
        },
        clearRegion: () => set({ region: null }),

        notifications: [],
        notify: (n) => {
            const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            set((s) => ({ notifications: [...s.notifications, { ...n, id }] }));
        },
        dismissNotification: (id) =>
            set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) })),

        connect: async () => {
            log("connect() invoked");
            try {
                await engine.connect();
                log("connect() ok, mode=%s", engine.getConfig() ? "serial" : "?");
                get().notify({ type: "success", message: "Connected to serial port" });
            } catch (e) {
                log("connect() failed: %s", e instanceof Error ? e.message : String(e));
                get().notify({
                    type: "error",
                    title: "Connect failed",
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        },
        simulate: () => {
            log("simulate() invoked");
            engine.simulate();
            log("simulate() done, mode=%s", get().mode);
            get().notify({ type: "info", message: "Simulate mode ready — press Start" });
        },
        start: () => {
            log("start() invoked, mode=%s running=%s", get().mode, get().running);
            engine.start();
            log("start() returned, running=%s", get().running);
        },
        pause: () => {
            log("pause() invoked, running=%s", get().running);
            engine.pause();
            log("pause() returned, running=%s", get().running);
        },
        clear: () => {
            log("clear() invoked");
            engine.clear();
            set({ region: null });
        },
        disconnect: async () => {
            log("disconnect() invoked");
            await engine.disconnect();
            set({ region: null });
            log("disconnect() returned, mode=%s", get().mode);
        },

        getEngine: () => engine,
    };
});
