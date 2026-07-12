// Phase 3 — Scope store (zustand). Owns the single ScopeEngine instance and is
// the sole UI API. Mirrors engine status (throttled) + holds config, T+0, and
// the two integrator tiers (session + drag-region). No drawing-store coupling.

import { create } from "zustand";
import { ScopeEngine } from "../scope/ScopeEngine";
import type { ScopeConfig, ScopeStatus } from "../scope/engineTypes";

// ponytail: one engine for the whole app. No need for context/provider.
const engine = new ScopeEngine();

const DEFAULT_CONFIG: ScopeConfig = {
    baudRate: 115200,
    avgSize: 10,
    windowSize: 1000,
    channels: { v: true, i: true, w: true },
};

// Throttle status → React to ~10 Hz so high pkt rates don't thrash renders.
const STATUS_THROTTLE_MS = 100;

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

    // lifecycle
    connect: () => Promise<void>;
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
        if (now - lastStatusPush < STATUS_THROTTLE_MS) return;
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
        // ponytail: surface via console; UI wires NotificationCenter in Phase 5.
        console.error("[scope]", e.message);
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

        setTZero: () => engine.markTZero(),
        resetTZero: () => engine.resetTZero(),

        resetSessionIntegrators: () => engine.resetSessionIntegrators(),

        region: null,
        setRegion: (tStartUs, tEndUs) => {
            const { energyJ, chargeC } = engine.computeRegion(tStartUs, tEndUs);
            set({ region: { tStartUs, tEndUs, energyJ, chargeC } });
        },
        clearRegion: () => set({ region: null }),

        connect: async () => {
            await engine.connect();
        },
        start: () => engine.start(),
        pause: () => engine.pause(),
        clear: () => {
            engine.clear();
            set({ region: null });
        },
        disconnect: async () => {
            await engine.disconnect();
            set({ region: null });
        },

        getEngine: () => engine,
    };
});
