// Main-thread scope engine (Phase 2). No Web Worker — ~11.5 KB/s is trivial.
// Pipeline: read chunks → PacketParser → AveragingBuffer (k) → DisplayRingBuffer (N).
// Read-only serial. T+0 offset + backward-jump guard keep the trace continuous.

import { PacketParser } from "./decode.ts";
import { AveragingBuffer } from "./AveragingBuffer.ts";
import { DisplayRingBuffer } from "./DisplayRingBuffer.ts";
import { Simulator } from "./simulate.ts";
import type {
    DisplaySnapshot,
    ErrorCallback,
    ScopeConfig,
    ScopeMode,
    ScopeStatus,
    StatusCallback,
} from "./engineTypes";
import { createDebug, createDebugThrottled } from "../utils/debug";

const log = createDebug("engine");
const logIngest = createDebugThrottled("engine:ingest", 500);

const DEFAULT_CONFIG: ScopeConfig = {
    baudRate: 115200,
    avgSize: 1,
    bufferSize: 1000,
    channels: { v: true, i: true, w: true },
    vScale: { auto: true, min: 0, max: 0 },
    hZoomSec: 0,
    vZoom: 1,
    followLatest: true,
};

// Backward timestamp jump larger than this (us) = device reboot / counter wrap.
const DISCONTINUITY_US = 1_000_000;

export class ScopeEngine {
    private config: ScopeConfig = { ...DEFAULT_CONFIG };
    private parser = new PacketParser();
    private avg: AveragingBuffer;
    private ring: DisplayRingBuffer;
    private sim = new Simulator();

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

    constructor() {
        this.avg = new AveragingBuffer(this.config.avgSize);
        this.ring = new DisplayRingBuffer(this.config.bufferSize);
    }

    onStatus(cb: StatusCallback): void {
        this.statusCb = cb;
    }
    onError(cb: ErrorCallback): void {
        this.errorCb = cb;
    }

    getConfig(): ScopeConfig {
        return this.config;
    }

    setConfig(patch: Partial<ScopeConfig>): void {
        if (patch.baudRate !== undefined) this.config.baudRate = patch.baudRate;
        if (patch.avgSize !== undefined && patch.avgSize !== this.config.avgSize) {
            this.config.avgSize = patch.avgSize;
            this.avg.resize(patch.avgSize);
        }
        if (patch.bufferSize !== undefined && patch.bufferSize !== this.config.bufferSize) {
            this.config.bufferSize = patch.bufferSize;
            this.ring.resize(patch.bufferSize);
        }
        if (patch.channels !== undefined) this.config.channels = { ...patch.channels };
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

    // Energy/charge over a display-time window [tStartUs, tEndUs] (us).
    // Trapezoid-integrate W and I across in-range points in the ring.
    computeRegion(tStartUs: number, tEndUs: number): { energyJ: number; chargeC: number } {
        const snap = this.ring.snapshot();
        const lo = Math.min(tStartUs, tEndUs);
        const hi = Math.max(tStartUs, tEndUs);
        let energyJ = 0;
        let chargeC = 0;
        let prevT: number | null = null;
        let prevW = 0;
        let prevI = 0;
        for (let k = 0; k < snap.t.length; k++) {
            const t = snap.t[k];
            if (t < lo || t > hi) {
                prevT = null;
                continue;
            }
            const w = snap.w[k];
            const i = snap.i[k];
            if (prevT !== null) {
                const dtS = (t - prevT) / 1_000_000;
                energyJ += 0.5 * (w + prevW) * dtS;
                chargeC += 0.5 * (i + prevI) * dtS;
            }
            prevT = t;
            prevW = w;
            prevI = i;
        }
        return { energyJ, chargeC };
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
        this.emitStatus();
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

        const displayT = point.t - this.tZeroOffsetUs;
        logIngest("ingest() point t=%s displayT=%s v=%s i=%s w=%s ringLen=%s", pkt.timestampUs, displayT, point.v.toFixed(3), point.i.toFixed(3), point.w.toFixed(3), this.ring.length);
        this.ring.push({ t: displayT, v: point.v, i: point.i, w: point.w });

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
