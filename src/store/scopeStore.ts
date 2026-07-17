// Zustand store for the scope engine state.
// Separate from the old drawing store — both coexist during transition.

import { create } from "zustand";
import type { ScopeConfig, ScopeStatus } from "../scope/types/engineTypes";
import type { BucketedTelemetryData } from "../scope/types/workerTypes";
import type { ScopeEngine } from "../scope/ingest/ScopeEngine";
import type { ScaleTier } from "../scope/lib/hysteresis";
import { readJSON, writeJSON } from "./storage";
import { BUCKET_PX_RATIO, BUCKET_COUNT_MIN, BUCKET_COUNT_MAX } from "../scope/constants";

const SCOPE_CONFIG_KEY = "scope_config";

export interface SelectionResult {
    energyJ: number;
    chargeC: number;
    dtUs: number;
    fromTs: number;   // μs
    toTs: number;     // μs
    avgV: number;
    peakV: number;
    avgI: number;
    peakI: number;
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

    // Dynamic viewport bucket count (auto-computed from chart width × ratio, clamped [50,4000])
    bucketCount: number;
    setBucketCount: (n: number) => void;
    // Actual chart container width in px (set by ResizeObserver)
    chartWidth: number;
    setChartWidth: (w: number) => void;
    // Recompute bucketCount from chartWidth + config ratio (call after ratio or mode change)
    recomputeBucketCount: () => void;

    // T+0 toggle state
    tZeroSet: boolean;
    setTZeroSet: (v: boolean) => void;

    // Engine ref (set once on mount, used by components for direct calls)
    engineRef: ScopeEngine | null;
    setEngineRef: (e: ScopeEngine | null) => void;

    // Serial connection actions (wired by useScopeEngineManager)
    connectSerial: () => Promise<void>;
    disconnectSerial: () => Promise<void>;
}

const BASE_DEFAULTS: ScopeConfig = {
    baudRate: 115200,
    ringCapacity: 1_000_000,
    avgSize: 50,
    windowSize: 1000,
    avgMode: "simple",
    channels: { v: true, i: true, w: true },
    nominalSampleRate: 10000,
    expectedSamplesPerPacket: 10,
    packetSmoothing: -1,
    bucketWidthMode: 'auto',
    bucketsPerPx: 2,
    voltageOffset: 0,
    currentOffsetLow: 0,
    currentOffsetMid: 0,
    currentOffsetHigh: 0,
};

/** Merge persisted config on top of base defaults. */
function loadConfig(): ScopeConfig {
    const saved = readJSON<Partial<ScopeConfig>>(SCOPE_CONFIG_KEY, {});
    return { ...BASE_DEFAULTS, ...saved };
}

function persistConfig(cfg: ScopeConfig): void {
    writeJSON(SCOPE_CONFIG_KEY, cfg);
}

const defaultConfig: ScopeConfig = loadConfig();

const defaultStatus: ScopeStatus = {
    running: false,
    mode: "idle",
    samplesPerSec: 0,
    observationCount: 0,
    avgSamplesPerPacket: 0,
    bufferFillPct: 0,
    lastTimestampUs: 0,
    liveV: 0,
    liveI: 0,
    liveW: 0,
    packetWarning: null,
    followIngest: true,
    cursorLocked: true,
};

// Debounced apply so rapid config changes (e.g. resize) don't replay the raw ring every frame.
let _applyTimer: ReturnType<typeof setTimeout> | null = null;
const _doApply = (eng: ScopeEngine, cfg: ScopeConfig) => {
    eng.setDisplayWindow(cfg.windowSize, cfg.avgSize);
    eng.avgMode = cfg.avgMode;
    eng.sampleIntervalUs = 1_000_000 / cfg.nominalSampleRate;
    eng.expectedSamplesPerPacket = cfg.expectedSamplesPerPacket;
    eng.packetSmoothing = cfg.packetSmoothing;
    // Sync calibration offsets to the engine (applied at decode time)
    eng.voltageOffset = cfg.voltageOffset;
    eng.currentOffsetLow = cfg.currentOffsetLow;
    eng.currentOffsetMid = cfg.currentOffsetMid;
    eng.currentOffsetHigh = cfg.currentOffsetHigh;
};

export const useScopeStore = create<ScopeStoreState>((set, get) => ({
    config: defaultConfig,
    status: defaultStatus,
    setConfig: (patch) => set((s) => {
        const next = { ...s.config, ...patch };
        persistConfig(next);
        return { config: next };
    }),
    applyConfigToEngine: () => {
        if (_applyTimer) clearTimeout(_applyTimer);
        _applyTimer = setTimeout(() => {
            _applyTimer = null;
            const { config, engineRef } = get();
            if (!engineRef) return;
            _doApply(engineRef, config);
        }, 100);
        // Also recompute bucket count for auto/semi-auto modes
        get().recomputeBucketCount();
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

    bucketCount: 200,
    setBucketCount: (bucketCount) => set({ bucketCount }),
    chartWidth: 0,
    setChartWidth: (chartWidth) => set({ chartWidth }),
    recomputeBucketCount: () => {
        const { config, chartWidth } = get();
        if (chartWidth <= 0) return;
        if (config.bucketWidthMode === 'manual') return;
        const ratio = config.bucketWidthMode === 'semi-auto' ? config.bucketsPerPx : BUCKET_PX_RATIO;
        const bc = Math.max(BUCKET_COUNT_MIN, Math.min(BUCKET_COUNT_MAX, Math.round(chartWidth / ratio)));
        set({ bucketCount: bc });
    },

    tZeroSet: false,
    setTZeroSet: (tZeroSet) => set({ tZeroSet }),

    engineRef: null,
    setEngineRef: (engineRef) => set({ engineRef }),

    connectSerial: async () => { },
    disconnectSerial: async () => { },
}));
