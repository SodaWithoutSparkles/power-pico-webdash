// Single-threaded scope engine.
// Owns the ring buffer, packet parser, integrator, and simulator.
// Replaces the Web Worker design — called directly from the main thread.

import { PacketParser } from "../decode/decode";
import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";
import { calculateBuckets } from "../lib/bucket";
import { DualStageIntegrator, integrateRange } from "../lib/integrator";
import { Simulator } from "./simulate";
import type { BucketedTelemetryData, StatusPayload } from "../types/workerTypes";


export class ScopeEngine {
    readonly ring: TelemetryRingBuffer;
    readonly integrator: DualStageIntegrator;
    avgMode: "simple" | "lttb" = "simple";

    // ── Display rings (bucketed min/mean/max series) ──
    // All three are always the same length (same push pattern in ingestSample).
    private _displayMaxRing: TelemetryRingBuffer;
    private _displayMeanRing: TelemetryRingBuffer;
    private _displayMinRing: TelemetryRingBuffer;
    private _displayTempRing: TelemetryRingBuffer | null = null;
    private _avgWindowSize: number;
    private _displayCapacity: number;

    // Cursor into the display rings (logical index, 0 = oldest, length = past-the-end).
    private _cursor = 0;

    private parser: PacketParser;
    private simulator: Simulator | null = null;
    private simulateInterval: ReturnType<typeof setInterval> | null = null;

    running = false;
    mode: "idle" | "serial" | "simulate" = "idle";
    pktPerSec = 0;
    sampleCount = 0;
    private lastStatusTs = 0;
    private pktCountSinceStatus = 0;
    tZeroOffset = 0;
    lastPacketTS = 0; // last raw packet timestamp ingested
    deltaBetweenPackets = 0; // time between last two packets (us)

    constructor(capacity = 1_000_000, displayCapacity = 10_000, avgWindowSize = 10) {
        if (avgWindowSize < 1) throw new Error("avgWindowSize must be >= 1");
        if (capacity < 1) throw new Error("capacity must be >= 1");
        if (displayCapacity < 1) throw new Error("displayCapacity must be >= 1");
        if (displayCapacity > capacity) throw new Error("displayCapacity must be <= capacity");
        if (avgWindowSize * displayCapacity > capacity) throw new Error("avgWindowSize * displayCapacity must be <= capacity");

        this._avgWindowSize = avgWindowSize;
        this._displayCapacity = displayCapacity;
        this.ring = new TelemetryRingBuffer(capacity);
        this._displayMaxRing = new TelemetryRingBuffer(displayCapacity);
        this._displayMeanRing = new TelemetryRingBuffer(displayCapacity);
        this._displayMinRing = new TelemetryRingBuffer(displayCapacity);
        this._displayTempRing = avgWindowSize > 1 ? new TelemetryRingBuffer(avgWindowSize) : null;
        this.parser = new PacketParser();
        this.integrator = new DualStageIntegrator();
        this.lastStatusTs = performance.now();
    }

    // ── Display window config ──

    /** Reconfigure the display rings and/or averaging window. Preserves raw ring. */
    setDisplayWindow(displayCapacity: number, avgWindowSize: number): void {
        if (avgWindowSize < 1) throw new Error("avgWindowSize must be >= 1");
        if (displayCapacity < 1) throw new Error("displayCapacity must be >= 1");
        if (displayCapacity > this.ring.capacity) throw new Error("displayCapacity must be <= raw ring capacity");
        if (avgWindowSize * displayCapacity > this.ring.capacity)
            throw new Error("avgWindowSize * displayCapacity must be <= raw ring capacity");

        this._avgWindowSize = avgWindowSize;
        this._displayCapacity = displayCapacity;
        this._displayMaxRing = new TelemetryRingBuffer(displayCapacity);
        this._displayMeanRing = new TelemetryRingBuffer(displayCapacity);
        this._displayMinRing = new TelemetryRingBuffer(displayCapacity);
        this._displayTempRing = avgWindowSize > 1 ? new TelemetryRingBuffer(avgWindowSize) : null;
        this._cursor = 0;
    }

    get avgWindowSize(): number { return this._avgWindowSize; }
    get displayCapacity(): number { return this._displayCapacity; }

    // ── Display cursor ──

    /** Move cursor to the end (newest data). */
    setCursorToEnd(): void {
        this._cursor = this._displayMeanRing.length;
    }

    /** Move cursor to a fraction of the display ring: 0.0 = oldest, 1.0 = newest. */
    setCursorToFraction(f: number): void {
        const len = this._displayMeanRing.length;
        if (len === 0) { this._cursor = 0; return; }
        this._cursor = Math.max(0, Math.min(len, Math.round(f * len)));
    }

    /** Current cursor position as a fraction [0, 1]. 1 = newest. */
    getCursorFraction(): number {
        const len = this._displayMeanRing.length;
        return len > 0 ? this._cursor / len : 0;
    }

    // ── Reading from display rings ──

    /**
     * Read up to `count` display buckets ending at the cursor.
     * Returns points in chronological order.
     */
    readDisplayWindow(count: number): BucketedTelemetryData {
        if (count <= 0) return this._emptyBuckets();
        const len = this._displayMeanRing.length;
        if (len === 0) return this._emptyBuckets();

        const start = Math.max(0, this._cursor - count);
        const actualCount = this._cursor - start;
        if (actualCount <= 0) return this._emptyBuckets();

        return this._sliceDisplay(start, this._cursor);
    }

    /**
     * Convenience: read the latest `count` display buckets (live view).
     * Equivalent to setCursorToEnd() + readDisplayWindow(count).
     */
    getLatestWindow(count: number): BucketedTelemetryData {
        this.setCursorToEnd();
        return this.readDisplayWindow(count);
    }

    /** Integrate a range of the raw ring buffer. */
    getIntegration(
        startTs: bigint,
        endTs: bigint,
    ): { energyJ: number; chargeC: number; dtUs: number } {
        return integrateRange(this.ring, startTs, endTs);
    }

    /** Current dual-stage integrator totals (session energy & charge). */
    getSessionTotals(): { energyJ: number; chargeC: number } {
        return this.integrator.getTotals();
    }

    // ── Actions ──

    start(): void {
        this.running = true;
    }

    pause(): void {
        this.running = false;
        this.stopSimulateInternal();
    }

    clear(): void {
        this.ring.clear();
        this._displayMaxRing.clear();
        this._displayMeanRing.clear();
        this._displayMinRing.clear();
        this._cursor = 0;
        this.parser.reset();
        this.integrator.reset();
        this.sampleCount = 0;
        this.pktPerSec = 0;
        this.pktCountSinceStatus = 0;
    }

    disconnect(): void {
        this.running = false;
        this.mode = "idle";
        this.parser.reset();
    }

    startSimulate(): void {
        this.simulator = new Simulator(1000, 10, 0.5); // 1000 pkt/s, 10 samples/pkt, 0.5 Hz sine wave
        this.mode = "simulate";
        this.running = true;

        if (this.simulateInterval) clearInterval(this.simulateInterval);
        this.simulateInterval = setInterval(() => {
            if (!this.running || !this.simulator) return;
            const pkt = this.simulator.next();
            const packets = [pkt];
            for (const p of packets) {
                this.deltaBetweenPackets = p.timestampUs - this.lastPacketTS;
                this.lastPacketTS = p.timestampUs;
                const deltaBetweenSamples = this.deltaBetweenPackets / p.samples.length;
                let rollingSampleTs = p.timestampUs - this.deltaBetweenPackets;
                for (const s of p.samples) {
                    this.ingestSample(rollingSampleTs + deltaBetweenSamples, s.volts, s.amps);
                    rollingSampleTs += deltaBetweenSamples;
                }
            }
        }, 1000 / this.simulator.pktRateHz);
    }

    stopSimulate(): void {
        this.stopSimulateInternal();
    }

    private stopSimulateInternal(): void {
        if (this.simulateInterval !== null) {
            clearInterval(this.simulateInterval);
            this.simulateInterval = null;
        }
        this.simulator = null;
        if (this.mode === "simulate") {
            this.mode = "idle";
            this.running = false;
        }
    }

    // ── Serial data ingestion ──

    pushSerialData(data: Uint8Array): void {
        const packets = this.parser.push(data);
        for (const pkt of packets) {
            this.deltaBetweenPackets = pkt.timestampUs - this.lastPacketTS;
            this.lastPacketTS = pkt.timestampUs;
            const deltaBetweenSamples = this.deltaBetweenPackets / pkt.samples.length;
            let rollingSampleTs = pkt.timestampUs - this.deltaBetweenPackets;
            for (const s of pkt.samples) {
                this.ingestSample(rollingSampleTs + deltaBetweenSamples, s.volts, s.amps);
                rollingSampleTs += deltaBetweenSamples;
            }
        }
    }

    // ── Internal ──

    private ingestSample(tsUs: number, voltage: number, current: number): void {
        const adjustedTs = BigInt(tsUs) - BigInt(this.tZeroOffset);
        this.ring.push(adjustedTs, voltage, current);
        this.integrator.push(adjustedTs, voltage, current);
        this._displayTempRing?.push(adjustedTs, voltage, current);
        this.sampleCount++;
        this.pktCountSinceStatus++;

        if (this._avgWindowSize === 1) {
            this._displayMaxRing.push(adjustedTs, voltage, current);
            this._displayMeanRing.push(adjustedTs, voltage, current);
            this._displayMinRing.push(adjustedTs, voltage, current);
        } else if (this._displayTempRing && this._displayTempRing.length >= this._avgWindowSize) {
            const lastTs = this._displayTempRing.timestamps[this._displayTempRing.lastIdx];
            const bucketedV = calculateBuckets(this._displayTempRing.voltages, 1, this.avgMode)[0];
            const bucketedI = calculateBuckets(this._displayTempRing.currents, 1, this.avgMode)[0];
            this._displayMaxRing.push(lastTs, bucketedV.max, bucketedI.max);
            this._displayMeanRing.push(lastTs, bucketedV.avg, bucketedI.avg);
            this._displayMinRing.push(lastTs, bucketedV.min, bucketedI.min);
        }
    }

    /** Slice the logical range [start, end) across all three display rings into a BucketedTelemetryData. */
    private _sliceDisplay(start: number, end: number): BucketedTelemetryData {
        const maxData = this._displayMaxRing.slice(
            (this._displayMaxRing.tailIdx + start) % this._displayMaxRing.capacity,
            (this._displayMaxRing.tailIdx + end) % this._displayMaxRing.capacity,
        );
        const meanData = this._displayMeanRing.slice(
            (this._displayMeanRing.tailIdx + start) % this._displayMeanRing.capacity,
            (this._displayMeanRing.tailIdx + end) % this._displayMeanRing.capacity,
        );
        const minData = this._displayMinRing.slice(
            (this._displayMinRing.tailIdx + start) % this._displayMinRing.capacity,
            (this._displayMinRing.tailIdx + end) % this._displayMinRing.capacity,
        );
        return {
            timestamps: Float64Array.from(meanData.timestamps, (ts) => Number(ts)),
            avgV: meanData.voltages,
            minV: minData.voltages,
            maxV: maxData.voltages,
            avgI: meanData.currents,
            minI: minData.currents,
            maxI: maxData.currents,
        };
    }

    // ── T+0 offset ──

    setTZero(rawTsUs: number): void {
        this.tZeroOffset = rawTsUs;
    }

    resetTZero(): void {
        this.tZeroOffset = 0;
    }

    // ── Status ──

    /** Latest status snapshot. Call once per frame. */
    computeStatus(): StatusPayload {
        const now = performance.now();
        const dtMs = now - this.lastStatusTs;
        if (dtMs > 0) {
            this.pktPerSec = Math.round((this.pktCountSinceStatus / dtMs) * 1000);
        }
        this.lastStatusTs = now;
        this.pktCountSinceStatus = 0;

        const len = this.ring.length;
        const lastIdx = len > 0 ? (this.ring.headIdx === 0 ? this.ring.capacity - 1 : this.ring.headIdx - 1) : 0;
        const liveV = len > 0 ? this.ring.voltages[lastIdx] : 0;
        const liveI = len > 0 ? this.ring.currents[lastIdx] : 0;

        return {
            running: this.running,
            mode: this.mode,
            pktPerSec: this.pktPerSec,
            sampleCount: this.sampleCount,
            bufferFillPct: this.ring.fillPct,
            liveV,
            liveI,
            liveW: liveV * liveI,
            lastTimestampUs: len > 0 ? Number(this.ring.timestamps[lastIdx]) : 0,
        };
    }

    /** Peak current across the entire ring buffer (used for hysteresis). */
    computePeakCurrent(): number {
        let peak = 0;
        const len = this.ring.length;
        if (len === 0) return 0;
        const tail = this.ring.tailIdx;
        const cap = this.ring.capacity;
        for (let i = 0; i < len; i++) {
            const idx = (tail + i) % cap;
            const a = Math.abs(this.ring.currents[idx]);
            if (a > peak) peak = a;
        }
        return peak;
    }

    // ── Helpers ──

    private _emptyBuckets(): BucketedTelemetryData {
        return {
            timestamps: new Float64Array(0),
            avgV: new Float32Array(0),
            minV: new Float32Array(0),
            maxV: new Float32Array(0),
            avgI: new Float32Array(0),
            minI: new Float32Array(0),
            maxI: new Float32Array(0),
        };
    }
}
