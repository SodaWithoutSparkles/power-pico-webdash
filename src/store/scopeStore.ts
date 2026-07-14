// Zustand store for the scope engine state.
// Separate from the old drawing store — both coexist during transition.

import { create } from "zustand";
import type { ScopeConfig, ScopeStatus } from "../scope/engineTypes";
import type { BucketedTelemetryData } from "../scope/workerTypes";

export interface SelectionResult {
    energyJ: number;
    chargeC: number;
    dtUs: number;
}

export interface ScopeStoreState {
    // Config
    config: ScopeConfig;
    setConfig: (patch: Partial<ScopeConfig>) => void;

    // Status (updated by worker messages)
    status: ScopeStatus;
    setStatus: (s: ScopeStatus) => void;

    // Bucketed data (latest from get-data-since)
    latestData: BucketedTelemetryData | null;
    setLatestData: (d: BucketedTelemetryData | null) => void;

    // Drag selection result
    selection: SelectionResult | null;
    setSelection: (sel: SelectionResult | null) => void;

    // Worker ref (set once on mount)
    workerRef: Worker | null;
    setWorkerRef: (w: Worker | null) => void;
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

    workerRef: null,
    setWorkerRef: (workerRef) => set({ workerRef }),
}));
