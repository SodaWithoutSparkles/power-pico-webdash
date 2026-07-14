// Zustand store for the scope engine state.
// Separate from the old drawing store — both coexist during transition.

import { create } from "zustand";
import type { ScopeConfig, ScopeStatus } from "../scope/types/engineTypes";
import type { BucketedTelemetryData } from "../scope/types/workerTypes";
import type { ScopeEngine } from "../scope/ingest/ScopeEngine";
import type { ScaleTier } from "../scope/lib/hysteresis";

export interface SelectionResult {
    energyJ: number;
    chargeC: number;
    dtUs: number;
}

export interface ScopeStoreState {
    // Config
    config: ScopeConfig;
    setConfig: (patch: Partial<ScopeConfig>) => void;
    /** Apply buffer config to the engine. Call after avgSize/windowSize changes. */
    applyConfigToEngine: () => void;

    // Status (updated by engine polling)
    status: ScopeStatus;
    setStatus: (s: ScopeStatus) => void;

    // Bucketed data (latest from polling)
    latestData: BucketedTelemetryData | null;
    setLatestData: (d: BucketedTelemetryData | null) => void;

    // Drag selection result
    selection: SelectionResult | null;
    setSelection: (sel: SelectionResult | null) => void;

    // Session energy / charge totals (updated periodically)
    sessionTotals: { energyJ: number; chargeC: number };
    setSessionTotals: (t: { energyJ: number; chargeC: number }) => void;

    // Current hysteresis tier for I-axis display scaling
    hysteresisTier: ScaleTier;
    setHysteresisTier: (t: ScaleTier) => void;

    // Engine ref (set once on mount, used by components for direct calls)
    engineRef: ScopeEngine | null;
    setEngineRef: (e: ScopeEngine | null) => void;

    // Serial connection actions (wired by useScopeEngineManager)
    connectSerial: () => Promise<void>;
    disconnectSerial: () => Promise<void>;
}

const defaultConfig: ScopeConfig = {
    baudRate: 115200,
    ringCapacity: 1_000_000,
    avgSize: 50,
    windowSize: 1000,
    avgMode: "simple",
    channels: { v: true, i: true, w: true },
    nominalSampleRate: 10000,
    expectedSamplesPerPacket: 10,
    packetSmoothing: -1,
};

const defaultStatus: ScopeStatus = {
    running: false,
    mode: "idle",
    samplesPerSec: 0,
    observationCount: 0,
    bufferFillPct: 0,
    lastTimestampUs: 0,
    liveV: 0,
    liveI: 0,
    liveW: 0,
    packetWarning: null,
};

export const useScopeStore = create<ScopeStoreState>((set, get) => ({
    config: defaultConfig,
    status: defaultStatus,
    setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
    applyConfigToEngine: () => {
        const { config, engineRef } = get();
        if (!engineRef) return;
        engineRef.setDisplayWindow(config.windowSize, config.avgSize);
        engineRef.avgMode = config.avgMode;
    },
    setStatus: (status) => set({ status }),

    latestData: null,
    setLatestData: (latestData) => set({ latestData }),

    selection: null,
    setSelection: (selection) => set({ selection }),

    sessionTotals: { energyJ: 0, chargeC: 0 },
    setSessionTotals: (sessionTotals) => set({ sessionTotals }),

    hysteresisTier: "ma" as ScaleTier,
    setHysteresisTier: (hysteresisTier) => set({ hysteresisTier }),

    engineRef: null,
    setEngineRef: (engineRef) => set({ engineRef }),

    connectSerial: async () => { },
    disconnectSerial: async () => { },
}));
