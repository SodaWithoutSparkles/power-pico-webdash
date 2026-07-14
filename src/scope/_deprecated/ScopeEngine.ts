// Main-thread scope engine (Phase 2). No Web Worker — ~11.5 KB/s is trivial.
// Pipeline: read chunks → PacketParser → AveragingBuffer (k) → DisplayRingBuffer (N).
// Read-only serial. T+0 offset + backward-jump guard keep the trace continuous.

import { PacketParser } from "../decode/decode.ts";
import { AveragingBuffer } from "./AveragingBuffer.ts";
import { DisplayRingBuffer } from "./DisplayRingBuffer.ts";
import { Simulator } from "../ingest/simulate.ts";
import type {
    DisplaySnapshot,
    ErrorCallback,
    ScopeConfig,
    ScopeMode,
    ScopeStatus,
    StatusCallback,
} from "../types/engineTypes";

const DEFAULT_CONFIG: ScopeConfig = {
    baudRate: 115200,
    ringCapacity: 1_000_000,
    avgSize: 10,
    windowSize: 1000,
    avgMode: "simple",
    channels: { v: true, i: true, w: true },
    nominalSampleRate: 10000,
    expectedSamplesPerPacket: 10,
    packetSmoothing: -1,
};

// Backward timestamp jump larger than this (us) = device reboot / counter wrap.
const DISCONTINUITY_US = 1_000_000;

export class ScopeEngine {
    private config: ScopeConfig = { ...DEFAULT_CONFIG };
    private parser = new PacketParser();
    private avg: AveragingBuffer;
    private ring: DisplayRingBuffer;

    // sim match real device: 10 pkts/ms
    private sim = new Simulator(
        1000, // pktRateHz
        10,   // samplesPerPkt
        0.5,  // freqHz
    );

    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private simTimer: ReturnType<typeof setInterval> | null = null;

    private mode: ScopeMode = "idle";
    private running = false;
    private tZeroOffsetUs = 0;
    private lastRawTsUs = 0;

    private pktCount = 0;
    private sampleCount = 0;
    private pktWindowStart = 0;
    private pktWindowCount = 0;

    private statusCb: StatusCallback | null = null;
    private errorCb: ErrorCallback | null = null;

    constructor() {
        this.avg = new AveragingBuffer(this.config.avgSize);
        this.ring = new DisplayRingBuffer(this.config.windowSize);
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
        if (patch.windowSize !== undefined && patch.windowSize !== this.config.windowSize) {
            this.config.windowSize = patch.windowSize;
            this.ring.resize(patch.windowSize);
        }
        if (patch.channels !== undefined) this.config.channels = { ...patch.channels };
    }

    // --- T+0 offset -------------------------------------------------------
    setTZero(rawTsUs: number): void {
        this.tZeroOffsetUs = rawTsUs;
    }
    resetTZero(): void {
        this.tZeroOffsetUs = 0;
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
    }

    // --- Lifecycle --------------------------------------------------------
    start(): void {
        if (this.running) return;
        this.running = true;
        if (this.mode === "simulate" || this.mode === "idle") {
            this.startSimulate();
        } else if (this.mode === "serial" && this.port) {
            this.startSerialRead();
        }
        this.emitStatus();
    }

    pause(): void {
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
    pushPacket(pkt: import("../decode/decode").DecodedPacket): void {
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
    private ingest(pkt: import("../decode/decode").DecodedPacket): void {
        this.pktCount++;
        this.sampleCount += pkt.dataCount;
        this.trackPktRate();

        // Discontinuity guard: backward jump > 1s shifts T+0 to stay continuous.
        if (this.lastRawTsUs !== 0 && pkt.timestampUs < this.lastRawTsUs - DISCONTINUITY_US) {
            this.tZeroOffsetUs += this.lastRawTsUs - pkt.timestampUs;
        }
        this.lastRawTsUs = pkt.timestampUs;

        const point = this.avg.push(pkt);
        if (!point) return;

        const displayT = point.t - this.tZeroOffsetUs;
        this.ring.push({ t: displayT, v: point.v, i: point.i, w: point.w });
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
            samplesPerSec: this.pktPerSec,
            observationCount: this.sampleCount,
            bufferFillPct: this.ring.fillPct,
            lastTimestampUs: this.lastRawTsUs,
            liveV,
            liveI,
            liveW,
            packetWarning: null,
        };
        this.statusCb?.(status);
    }
}
