// Main-thread scope engine (Phase 2). No Web Worker — ~81 KB/s (81 B/pkt × 1000 pkt/s, 10 samples) is trivial.
// Pipeline: read chunks → PacketParser → AveragingBuffer (k) → DisplayRingBuffer (N).
// Read-only serial. T+0 offset + backward-jump guard keep the trace continuous.

import { PacketParser } from "./decode.ts";
import { AveragingBuffer } from "./AveragingBuffer.ts";
import { DisplayRingBuffer } from "./DisplayRingBuffer.ts";
import { Simulator } from "./simulate.ts";
import { Detector } from "./Detector";
import type {
    CurrentUnit,
    DisplaySnapshot,
    ErrorCallback,
    PowerUnit,
    ScopeConfig,
    ScopeMode,
    ScopeStatus,
    StatusCallback,
    VoltageUnit,
    RegionStats,
    DetectorEvent,
    DetectorChannelConfig,
} from "./engineTypes";
import { createDebug, createDebugThrottled } from "../utils/debug";

const log = createDebug("engine");
const logIngest = createDebugThrottled("engine:ingest", 500);

export const DEFAULT_CONFIG: ScopeConfig = {
    baudRate: 115200,
    avgSize: 1,
    channels: { v: true, i: true, w: false },
    hZoomSec: 0,
    followLatest: true,
    pktPerSec: 1000,
    bufferSec: 5,
    vZeroOffsetV: 0,
    iZeroOffsetA: 0,
    energyCamp: 'joules',
    vUnitMode: 'si',
    iUnitMode: 'si',
    vFixedUnit: 'V',
    iFixedUnit: 'A',
    vYScale: { auto: true, min: 0, max: 0 },
    iYScale: { auto: true, min: 0, max: 0 },
    wYScale: { auto: true, min: 0, max: 0 },
    calibrationTimeSec: 5,
};

// Backward timestamp jump larger than this (us) = device reboot / counter wrap.
const DISCONTINUITY_US = 1_000_000;

// Hysteresis thresholds for unit switching.
// Going up (value increasing): switch at next unit boundary.
// Going down (value decreasing): switch 10x lower to prevent flap.
// E.g., for Voltage: in mV, switch to V at >= 1.0; in V, switch to mV at < 0.1.

const V_UNIT_THRESHOLDS: { unit: VoltageUnit; max: number }[] = [
    { unit: 'uV', max: 999e-6 },  // < 0.000999 = 999 uV
    { unit: 'mV', max: 0.999 },    // < 0.999 = 999 mV
    { unit: 'V', max: Infinity },
];

const A_UNIT_THRESHOLDS: { unit: CurrentUnit; max: number }[] = [
    { unit: 'uA', max: 999e-6 },
    { unit: 'mA', max: 0.999 },
    { unit: 'A', max: Infinity },
];

const W_UNIT_THRESHOLDS: { unit: PowerUnit; max: number }[] = [
    { unit: 'uW', max: 999e-6 },
    { unit: 'mW', max: 0.999 },
    { unit: 'W', max: Infinity },
];

// Pick the best unit for a value given current unit (for hysteresis).
// value is always in base units (V, A, W).
// currentUnit is the unit we're currently displaying.
export function autoVoltageUnit(value: number, currentUnit: VoltageUnit): VoltageUnit {
    const abs = Math.abs(value);
    const thresholds = V_UNIT_THRESHOLDS;
    // Find current unit index
    let idx = thresholds.findIndex(t => t.unit === currentUnit);
    if (idx < 0) idx = thresholds.length - 1;
    // Hysteresis: if going down, stay in current unit unless value < current unit max / 10
    if (idx > 0 && abs < thresholds[idx - 1].max / 10) {
        // Move down one step
        return thresholds[idx - 1].unit;
    }
    // If going up: value > current unit max → move up
    while (idx < thresholds.length - 1 && abs >= thresholds[idx].max) {
        idx++;
    }
    return thresholds[idx].unit;
}

// Same pattern for current and power
export function autoCurrentUnit(value: number, currentUnit: CurrentUnit): CurrentUnit {
    const abs = Math.abs(value);
    const thresholds = A_UNIT_THRESHOLDS;
    let idx = thresholds.findIndex(t => t.unit === currentUnit);
    if (idx < 0) idx = thresholds.length - 1;
    if (idx > 0 && abs < thresholds[idx - 1].max / 10) {
        return thresholds[idx - 1].unit;
    }
    while (idx < thresholds.length - 1 && abs >= thresholds[idx].max) {
        idx++;
    }
    return thresholds[idx].unit;
}

export function autoPowerUnit(value: number, currentUnit: PowerUnit): PowerUnit {
    const abs = Math.abs(value);
    const thresholds = W_UNIT_THRESHOLDS;
    let idx = thresholds.findIndex(t => t.unit === currentUnit);
    if (idx < 0) idx = thresholds.length - 1;
    if (idx > 0 && abs < thresholds[idx - 1].max / 10) {
        return thresholds[idx - 1].unit;
    }
    while (idx < thresholds.length - 1 && abs >= thresholds[idx].max) {
        idx++;
    }
    return thresholds[idx].unit;
}

// Convert a value from base units to the given unit (for display)
export function toUnitValue(value: number, unit: string): number {
    switch (unit) {
        case 'uV': case 'uA': case 'uW': return value * 1_000_000;
        case 'mV': case 'mA': case 'mW': return value * 1_000;
        case 'V': case 'A': case 'W': return value;
        default: return value;
    }
}

export class ScopeEngine {
    private config: ScopeConfig = { ...DEFAULT_CONFIG };
    private parser = new PacketParser();
    private avg: AveragingBuffer;
    private ring: DisplayRingBuffer;
    private sim = new Simulator();
    private detector = new Detector();

    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private simTimer: ReturnType<typeof setInterval> | null = null;

    private mode: ScopeMode = "idle";
    private running = false;
    private tZeroOffsetUs = 0;
    private lastRawTsUs = 0;

    // Session integrators (energy J, charge C) — accumulated per averaged point.
    private sessionEnergyJ = 0;
    private sessionChargeC = 0;
    private lastIntegrateTUs = 0; // display-time of previous integrated point

    private pktCount = 0;
    private sampleCount = 0;
    private pktWindowStart = 0;
    private pktWindowCount = 0;

    private statusCb: StatusCallback | null = null;
    private errorCb: ErrorCallback | null = null;
    private detectorCb: ((event: DetectorEvent) => void) | null = null;

    // Calibration mode: null = not calibrating, 'v' or 'i' = channel being calibrated
    private calibrating: 'v' | 'i' | null = null;
    private calValues: number[] = [];
    private calStartMs = 0;

    constructor() {
        this.avg = new AveragingBuffer(this.config.avgSize);
        this.ring = new DisplayRingBuffer(Math.max(1, Math.round(this.config.pktPerSec * this.config.bufferSec)));
    }

    onStatus(cb: StatusCallback): void {
        this.statusCb = cb;
    }
    onError(cb: ErrorCallback): void {
        this.errorCb = cb;
    }
    onDetectorEvent(cb: (event: DetectorEvent) => void): void {
        this.detectorCb = cb;
    }

    getConfig(): ScopeConfig {
        return { ...this.config };
    }

    setConfig(patch: Partial<ScopeConfig>): void {
        if (patch.baudRate !== undefined) this.config.baudRate = patch.baudRate;
        if (patch.avgSize !== undefined && patch.avgSize !== this.config.avgSize) {
            this.config.avgSize = patch.avgSize;
            this.avg.resize(patch.avgSize);
        }
        if (patch.bufferSec !== undefined) this.config.bufferSec = patch.bufferSec;
        if (patch.pktPerSec !== undefined) this.config.pktPerSec = patch.pktPerSec;
        if (patch.bufferSec !== undefined || patch.pktPerSec !== undefined) {
            const newBufferSize = Math.max(1, Math.round(this.config.pktPerSec * this.config.bufferSec));
            this.ring.resize(newBufferSize);
        }
        if (patch.channels !== undefined) this.config.channels = { ...patch.channels };
        if (patch.hZoomSec !== undefined) this.config.hZoomSec = patch.hZoomSec;
        if (patch.followLatest !== undefined) this.config.followLatest = patch.followLatest;
        if (patch.vZeroOffsetV !== undefined) this.config.vZeroOffsetV = patch.vZeroOffsetV;
        if (patch.iZeroOffsetA !== undefined) this.config.iZeroOffsetA = patch.iZeroOffsetA;
        if (patch.energyCamp !== undefined) this.config.energyCamp = patch.energyCamp;
        if (patch.vUnitMode !== undefined) this.config.vUnitMode = patch.vUnitMode;
        if (patch.iUnitMode !== undefined) this.config.iUnitMode = patch.iUnitMode;
        if (patch.vFixedUnit !== undefined) this.config.vFixedUnit = patch.vFixedUnit;
        if (patch.iFixedUnit !== undefined) this.config.iFixedUnit = patch.iFixedUnit;
        if (patch.vYScale !== undefined) this.config.vYScale = { ...patch.vYScale };
        if (patch.iYScale !== undefined) this.config.iYScale = { ...patch.iYScale };
        if (patch.wYScale !== undefined) this.config.wYScale = { ...patch.wYScale };
        if (patch.calibrationTimeSec !== undefined) this.config.calibrationTimeSec = patch.calibrationTimeSec;
    }

    // --- T+0 offset -------------------------------------------------------
    setTZero(rawTsUs: number): void {
        this.tZeroOffsetUs = rawTsUs;
    }
    resetTZero(): void {
        this.tZeroOffsetUs = 0;
        this.lastIntegrateTUs = 0; // avoid spurious dt after offset shift
    }

    // Set T+0 to the latest raw timestamp (UI "Set T=0" button).
    markTZero(): void {
        this.tZeroOffsetUs = this.lastRawTsUs;
        this.lastIntegrateTUs = 0; // re-baseline integration at new origin
        this.emitStatus();
    }

    resetSessionIntegrators(): void {
        this.sessionEnergyJ = 0;
        this.sessionChargeC = 0;
        this.lastIntegrateTUs = 0;
        this.emitStatus();
    }

    // Energy/charge + per-series avg/min/max over a display-time window
    // [tStartUs, tEndUs] (us). Trapezoid-integrate W and I across in-range
    // points; avg/min/max computed over finite samples only.
    computeRegion(tStartUs: number, tEndUs: number): RegionStats {
        const snap = this.ring.snapshot();
        const lo = Math.min(tStartUs, tEndUs);
        const hi = Math.max(tStartUs, tEndUs);

        let energyJ = 0;
        let chargeC = 0;
        let prevT: number | null = null;
        let prevW = 0;
        let prevI = 0;

        let vSum = 0, iSum = 0, wSum = 0;
        let vCount = 0, iCount = 0, wCount = 0;
        let vMin = Infinity, iMin = Infinity, wMin = Infinity;
        let vMax = -Infinity, iMax = -Infinity, wMax = -Infinity;

        for (let k = 0; k < snap.t.length; k++) {
            const t = snap.t[k];
            if (t < lo || t > hi) { prevT = null; continue; }

            const v = snap.v[k];
            const i = snap.i[k];
            const w = snap.w[k];

            // Energy/charge integration (trapezoid)
            if (prevT !== null) {
                const dtS = (t - prevT) / 1_000_000;
                energyJ += 0.5 * (w + prevW) * dtS;
                chargeC += 0.5 * (i + prevI) * dtS;
            }
            prevT = t; prevW = w; prevI = i;

            // Avg/min/max
            if (Number.isFinite(v)) {
                vSum += v; vCount++;
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
            }
            if (Number.isFinite(i)) {
                iSum += i; iCount++;
                if (i < iMin) iMin = i;
                if (i > iMax) iMax = i;
            }
            if (Number.isFinite(w)) {
                wSum += w; wCount++;
                if (w < wMin) wMin = w;
                if (w > wMax) wMax = w;
            }
        }

        return {
            energyJ,
            chargeC,
            vAvg: vCount > 0 ? vSum / vCount : null,
            vMin: vCount > 0 ? vMin : null,
            vMax: vCount > 0 ? vMax : null,
            iAvg: iCount > 0 ? iSum / iCount : null,
            iMin: iCount > 0 ? iMin : null,
            iMax: iCount > 0 ? iMax : null,
            wAvg: wCount > 0 ? wSum / wCount : null,
            wMin: wCount > 0 ? wMin : null,
            wMax: wCount > 0 ? wMax : null,
        };
    }

    // --- Connection -------------------------------------------------------
    async connect(): Promise<void> {
        if (!("serial" in navigator)) {
            throw new Error("Web Serial not supported in this browser");
        }
        // Prefer an already-authorized port (reconnect), else prompt.
        const ports = await navigator.serial.getPorts();
        this.port = ports[0] ?? (await navigator.serial.requestPort());
        await this.port.open({ baudRate: this.config.baudRate });
        this.mode = "serial";
        this.emitStatus(); // propagate mode→store so Start enables immediately
    }

    // --- Lifecycle --------------------------------------------------------
    start(): void {
        log("start() mode=%s running=%s", this.mode, this.running);
        if (this.running) return;
        this.running = true;
        if (this.mode === "simulate" || this.mode === "idle") {
            log("start() → startSimulate()");
            this.startSimulate();
        } else if (this.mode === "serial" && this.port) {
            log("start() → startSerialRead()");
            this.startSerialRead();
        } else {
            log("start() WARNING: no source to start (mode=%s port=%s)", this.mode, !!this.port);
        }
        this.emitStatus();
    }

    pause(): void {
        log("pause() running=%s", this.running);
        if (!this.running) return;
        this.running = false;
        this.stopSources();
        this.emitStatus();
    }

    clear(): void {
        this.parser.reset();
        this.avg.clear();
        this.ring.clear();
        this.pktCount = 0;
        this.sampleCount = 0;
        this.pktWindowCount = 0;
        this.lastRawTsUs = 0;
        this.sessionEnergyJ = 0;
        this.sessionChargeC = 0;
        this.lastIntegrateTUs = 0;
        this.detector.clearEvents();
        this.detector.reset();
        this.calibrating = null;
        this.calValues = [];
        this.emitStatus();
    }

    // --- Detector ---------------------------------------------------------
    setDetectorConfig(channel: 'v' | 'i', config: Partial<DetectorChannelConfig>): void {
        this.detector.setConfig(channel, config);
    }

    getDetectorEvents(): DetectorEvent[] {
        return this.detector.getEvents();
    }

    clearDetectorEvents(): void {
        this.detector.clearEvents();
    }

    resetDetector(channel?: 'v' | 'i'): void {
        this.detector.reset(channel);
    }

    // Enter simulate mode without starting ingestion (UI picks Start).
    simulate(): void {
        log("simulate()");
        this.mode = "simulate";
        this.sim.reset();
        this.emitStatus();
    }

    async disconnect(): Promise<void> {
        this.pause();
        this.stopSources();
        try {
            await this.reader?.cancel();
        } catch {
            /* ignore */
        }
        try {
            await this.port?.close();
        } catch {
            /* ignore */
        }
        this.port = null;
        this.mode = "idle";
        this.emitStatus();
    }

    // --- Data access ------------------------------------------------------
    snapshot(): DisplaySnapshot {
        return this.ring.snapshot();
    }

    // Feed a decoded packet directly (tests, or future non-serial sources).
    pushPacket(pkt: import("./decode").DecodedPacket): void {
        this.ingest(pkt);
    }

    // Collect live values for calibration. Returns a Promise that resolves
    // with the mean after calibrationTimeSec seconds. During the window the
    // offset for the calibrated channel is held at 0 so the raw noise is
    // measured; ingest() feeds the raw values into calValues.
    calibrate(channel: 'v' | 'i'): Promise<number> {
        return new Promise((resolve) => {
            this.calibrating = channel;
            this.calValues = [];
            this.calStartMs = performance.now();

            const check = () => {
                if (performance.now() - this.calStartMs >= this.config.calibrationTimeSec * 1000) {
                    this.calibrating = null;
                    const mean = this.calValues.length > 0
                        ? this.calValues.reduce((a, b) => a + b, 0) / this.calValues.length
                        : 0;
                    resolve(mean);
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });
    }

    // --- Internal: sources ------------------------------------------------
    private startSimulate(): void {
        this.mode = "simulate";
        this.sim.reset();
        this.simTimer = setInterval(() => {
            if (!this.running) return;
            const pkt = this.sim.next();
            this.ingest(pkt);
        }, 1000 / this.sim.pktRateHz);
    }

    private startSerialRead(): void {
        if (!this.port?.readable) return;
        this.reader = this.port.readable.getReader();
        void this.readLoopImpl();
    }

    private async readLoopImpl(): Promise<void> {
        if (!this.reader) return;
        try {
            while (this.running) {
                const { value, done } = await this.reader.read();
                if (done) break;
                if (value) {
                    for (const pkt of this.parser.push(value)) this.ingest(pkt);
                }
            }
        } catch (e) {
            this.errorCb?.(e instanceof Error ? e : new Error(String(e)));
        } finally {
            try {
                await this.reader?.releaseLock();
            } catch {
                /* ignore */
            }
            this.reader = null;
        }
    }

    private stopSources(): void {
        if (this.simTimer !== null) {
            clearInterval(this.simTimer);
            this.simTimer = null;
        }
    }

    // --- Core ingest: packet → averaged point → ring ----------------------
    private ingest(pkt: import("./decode").DecodedPacket): void {
        this.pktCount++;
        this.sampleCount += pkt.dataCount;
        this.trackPktRate();

        // Discontinuity guard: backward jump > 1s shifts T+0 to stay continuous.
        if (this.lastRawTsUs !== 0 && pkt.timestampUs < this.lastRawTsUs - DISCONTINUITY_US) {
            log("ingest() discontinuity: rawTs=%s lastRawTs=%s → shift tZero by %s", pkt.timestampUs, this.lastRawTsUs, this.lastRawTsUs - pkt.timestampUs);
            this.tZeroOffsetUs += this.lastRawTsUs - pkt.timestampUs;
        }
        this.lastRawTsUs = pkt.timestampUs;

        const point = this.avg.push(pkt);
        if (!point) return;

        // Calibration mode: hold offset at 0, collect raw values
        if (this.calibrating === 'v') {
            this.calValues.push(point.v);
            // Don't apply zero to V during calibration
        } else if (this.calibrating === 'i') {
            this.calValues.push(point.i);
            // Don't apply zero to I during calibration
        }

        if (this.calibrating !== 'v') {
            point.v = point.v - this.config.vZeroOffsetV;
        }
        if (this.calibrating !== 'i') {
            point.i = point.i - this.config.iZeroOffsetA;
        }
        point.w = point.v * point.i; // recompute with zeroed values

        // Auto-set T+0 to the first averaged point's raw timestamp when the
        // ring buffer is empty, so display timestamps always start near 0.
        if (this.ring.length === 0) {
            this.tZeroOffsetUs = point.t;
        }
        const displayT = point.t - this.tZeroOffsetUs;
        logIngest("ingest() point t=%s displayT=%s v=%s i=%s w=%s ringLen=%s", pkt.timestampUs, displayT, point.v.toFixed(3), point.i.toFixed(3), point.w.toFixed(3), this.ring.length);
        this.ring.push({ t: displayT, v: point.v, i: point.i, w: point.w, range: point.range });

        // Detector processing (per-channel). Events are stored in the detector
        // and exposed to the UI via getDetectorEvents()/syncDetectorEvents().
        const vEvent = this.detector.process('v', displayT, point.v);
        const iEvent = this.detector.process('i', displayT, point.i);
        if (vEvent && this.detectorCb) this.detectorCb(vEvent);
        if (iEvent && this.detectorCb) this.detectorCb(iEvent);

        // Session integrators: trapezoid over display-time deltas between
        // averaged points. First point only establishes the baseline.
        if (this.lastIntegrateTUs === 0) {
            this.lastIntegrateTUs = displayT;
        } else {
            const dtUs = displayT - this.lastIntegrateTUs;
            if (dtUs > 0) {
                const dtS = dtUs / 1_000_000;
                this.sessionEnergyJ += point.w * dtS;
                this.sessionChargeC += point.i * dtS;
                this.lastIntegrateTUs = displayT;
            }
        }

        this.emitStatus(point.v, point.i, point.w);
    }

    private trackPktRate(): void {
        const now = performance.now();
        if (this.pktWindowStart === 0) this.pktWindowStart = now;
        this.pktWindowCount++;
        const elapsed = now - this.pktWindowStart;
        if (elapsed >= 1000) {
            this.pktPerSec = (this.pktWindowCount * 1000) / elapsed;
            this.pktWindowStart = now;
            this.pktWindowCount = 0;
        }
    }
    private pktPerSec = 0;

    private emitStatus(liveV = 0, liveI = 0, liveW = 0): void {
        const status: ScopeStatus = {
            running: this.running,
            mode: this.mode,
            pktPerSec: this.pktPerSec,
            sampleCount: this.sampleCount,
            bufferFillPct: this.ring.fillPct,
            lastTimestampUs: this.lastRawTsUs,
            liveV,
            liveI,
            liveW,
            sessionEnergyJ: this.sessionEnergyJ,
            sessionChargeC: this.sessionChargeC,
            tZeroOffsetUs: this.tZeroOffsetUs,
        };
        this.statusCb?.(status);
    }
}
