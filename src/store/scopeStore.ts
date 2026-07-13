// Phase 3 — Scope store (zustand). Owns the single ScopeEngine instance and is
// the sole UI API. Mirrors engine status (throttled) + holds config, T+0, and
// the two integrator tiers (session + drag-region). No drawing-store coupling.

import { create } from "zustand";
import { ScopeEngine, DEFAULT_CONFIG } from "../scope/ScopeEngine";
import { DEFAULT_DETECTOR_CONFIG } from "../scope/Detector";
import type {
    CurrentUnit,
    ScopeConfig,
    ScopeStatus,
    UnitMode,
    VoltageUnit,
    YScale,
    DetectorChannelConfig,
    DetectorEvent,
} from "../scope/engineTypes";
import { createDebug } from "../utils/debug";
import { unlockAudio, playDetectorBeep } from "../scope/audioAlert";

const log = createDebug("store");

// ponytail: one engine for the whole app. No need for context/provider.
const engine = new ScopeEngine();
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
    vAvg: number | null;
    vMin: number | null;
    vMax: number | null;
    iAvg: number | null;
    iMin: number | null;
    iMax: number | null;
    wAvg: number | null;
    wMin: number | null;
    wMax: number | null;
}

export interface ScopeStoreState {
    // config
    config: ScopeConfig;
    setConfig: (patch: Partial<ScopeConfig>) => void;
    setVZeroOffset: (offset: number) => void;
    setIZeroOffset: (offset: number) => void;
    setEnergyCamp: (camp: "joules" | "watt-hours") => void;
    setBufferSec: (sec: number) => void;
    setPktPerSec: (rate: number) => void;

    // Phase 2: unit modes, fixed units, per-series Y scales, calibration
    setVUnitMode: (mode: UnitMode) => void;
    setIUnitMode: (mode: UnitMode) => void;
    setVFixedUnit: (unit: VoltageUnit) => void;
    setIFixedUnit: (unit: CurrentUnit) => void;
    setVYScale: (scale: Partial<YScale>) => void;
    setIYScale: (scale: Partial<YScale>) => void;
    setWYScale: (scale: Partial<YScale>) => void;
    setCalibrationTimeSec: (sec: number) => void;
    calibrate: (channel: 'v' | 'i') => Promise<void>;

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

    // settings panel visibility
    settingsOpen: boolean;
    toggleSettings: () => void;

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

    // detector (threshold crossing + peak detection)
    detectorEvents: DetectorEvent[];
    detectorVConfig: DetectorChannelConfig;
    detectorIConfig: DetectorChannelConfig;
    setDetectorConfig: (channel: 'v' | 'i', config: Partial<DetectorChannelConfig>) => void;
    getDetectorEvents: () => DetectorEvent[];
    clearDetectorEvents: () => void;
    syncDetectorEvents: () => void;
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

    // Throttle detector notifications: at most one per channel per second
    const detectorLastNotify: Record<string, number> = {};

    engine.onDetectorEvent((event) => {
        playDetectorBeep(event.channel);
        get().syncDetectorEvents();

        const now = Date.now();
        const key = event.channel;
        if (!detectorLastNotify[key] || now - detectorLastNotify[key] > 1000) {
            detectorLastNotify[key] = now;
            const dir = event.direction === 'rising' ? '↑' : '↓';
            get().notify({
                type: 'warning',
                title: `Detector: ${event.channel.toUpperCase()}`,
                message: `${dir} ${event.value.toFixed(4)} crossed threshold ${event.threshold.toFixed(3)}`,
                timeout: 3000,
            });
        }
    });

    return {
        config: { ...DEFAULT_CONFIG },

        setConfig: (patch) => {
            const next = { ...get().config, ...patch };
            engine.setConfig(patch);
            set({ config: next });
        },

        setVZeroOffset: (offset) => {
            engine.setConfig({ vZeroOffsetV: offset });
            set({ config: { ...get().config, vZeroOffsetV: offset } });
        },
        setIZeroOffset: (offset) => {
            engine.setConfig({ iZeroOffsetA: offset });
            set({ config: { ...get().config, iZeroOffsetA: offset } });
        },
        setEnergyCamp: (camp) => {
            engine.setConfig({ energyCamp: camp });
            set({ config: { ...get().config, energyCamp: camp } });
        },
        setBufferSec: (sec) => {
            engine.setConfig({ bufferSec: sec });
            set({ config: { ...get().config, bufferSec: sec } });
        },
        setPktPerSec: (rate) => {
            engine.setConfig({ pktPerSec: rate });
            set({ config: { ...get().config, pktPerSec: rate } });
        },

        setVUnitMode: (mode) => {
            engine.setConfig({ vUnitMode: mode });
            set({ config: { ...get().config, vUnitMode: mode } });
        },
        setIUnitMode: (mode) => {
            engine.setConfig({ iUnitMode: mode });
            set({ config: { ...get().config, iUnitMode: mode } });
        },
        setVFixedUnit: (unit) => {
            engine.setConfig({ vFixedUnit: unit });
            set({ config: { ...get().config, vFixedUnit: unit } });
        },
        setIFixedUnit: (unit) => {
            engine.setConfig({ iFixedUnit: unit });
            set({ config: { ...get().config, iFixedUnit: unit } });
        },
        setVYScale: (scale) => {
            const next = { ...get().config.vYScale, ...scale };
            engine.setConfig({ vYScale: next });
            set({ config: { ...get().config, vYScale: next } });
        },
        setIYScale: (scale) => {
            const next = { ...get().config.iYScale, ...scale };
            engine.setConfig({ iYScale: next });
            set({ config: { ...get().config, iYScale: next } });
        },
        setWYScale: (scale) => {
            const next = { ...get().config.wYScale, ...scale };
            engine.setConfig({ wYScale: next });
            set({ config: { ...get().config, wYScale: next } });
        },
        setCalibrationTimeSec: (sec) => {
            engine.setConfig({ calibrationTimeSec: sec });
            set({ config: { ...get().config, calibrationTimeSec: sec } });
        },
        calibrate: async (channel) => {
            const mean = await engine.calibrate(channel);
            if (channel === 'v') {
                engine.setConfig({ vZeroOffsetV: mean });
                set({ config: { ...get().config, vZeroOffsetV: mean } });
            } else {
                engine.setConfig({ iZeroOffsetA: mean });
                set({ config: { ...get().config, iZeroOffsetA: mean } });
            }
            get().notify({ type: 'success', message: `${channel.toUpperCase()} calibrated: offset=${mean.toFixed(6)}` });
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
            const stats = engine.computeRegion(tStartUs, tEndUs);
            set({ region: { tStartUs, tEndUs, ...stats } });
        },
        clearRegion: () => set({ region: null }),

        settingsOpen: false,
        toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

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
                unlockAudio();
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
            unlockAudio();
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

        detectorEvents: [],
        detectorVConfig: { ...DEFAULT_DETECTOR_CONFIG.v },
        detectorIConfig: { ...DEFAULT_DETECTOR_CONFIG.i },

        setDetectorConfig: (channel, config) => {
            engine.setDetectorConfig(channel, config);
            // ponytail: store in separate state field
            set((s) => {
                const vc = { ...s.detectorVConfig, ...(channel === 'v' ? config : {}) };
                const ic = { ...s.detectorIConfig, ...(channel === 'i' ? config : {}) };
                return { detectorVConfig: vc, detectorIConfig: ic };
            });
        },

        getDetectorEvents: () => engine.getDetectorEvents(),

        clearDetectorEvents: () => {
            engine.clearDetectorEvents();
            set({ detectorEvents: [] });
        },

        syncDetectorEvents: () => {
            set({ detectorEvents: engine.getDetectorEvents() });
        },
    };
});
