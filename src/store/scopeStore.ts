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
    avgSize: 5,
    windowSize: 500,
    channels: { v: true, i: true, w: true },
};

const defaultStatus: ScopeStatus = {
    running: false,
    mode: "idle",
    pktPerSec: 0,
    sampleCount: 0,
    bufferFillPct: 0,
    lastTimestampUs: 0,
    liveV: 0,
    liveI: 0,
    liveW: 0,
};

export const useScopeStore = create<ScopeStoreState>((set) => ({
    config: defaultConfig,
    setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

    status: defaultStatus,
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
