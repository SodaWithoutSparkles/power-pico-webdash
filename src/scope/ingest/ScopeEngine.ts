// Single-threaded scope engine.
// Owns the ring buffer, packet parser, integrator, and simulator.
// Replaces the Web Worker design — called directly from the main thread.

import { PacketParser } from "../decode/decode";
import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";
import { calculateBuckets } from "../lib/bucket";
import { DualStageIntegrator, integrateRange } from "../lib/integrator";
import { ExtremesTracker } from "../lib/extremesTracker";
import { sliceDisplay } from "../format/sliceDisplay";
import { Simulator } from "./simulate";
import { updateScaleDelta, type ScaleTier } from "../lib/hysteresis";
import type { BucketedTelemetryData, StatusPayload } from "../types/workerTypes";


export class ScopeEngine {
    readonly ring: TelemetryRingBuffer;
    readonly integrator: DualStageIntegrator;
    readonly extremes: ExtremesTracker;
    avgMode: "simple" | "lttb" = "simple";

    // ── Display rings (bucketed min/mean/max series) ──
    // All three are always the same length (same push pattern in ingestSample).
    // Init in _createDisplayRings() and rebuilt in setDisplayWindow().
    // @ts-expect-error
    private _displayMaxRing: TelemetryRingBuffer;
    // @ts-expect-error
    private _displayMeanRing: TelemetryRingBuffer;
    // @ts-expect-error
    private _displayMinRing: TelemetryRingBuffer;
    private _displayTempRing: TelemetryRingBuffer | null = null;
    private _avgWindowSize: number;
    private _displayCapacity: number;

    /**
     * Cursor offset from the TAIL (oldest data).
     *   0          = oldest element in the display ring.
     *   len        = past-the-end (at head / newest).
     *
     * When followIngest=true, _cursorOffset is set to len after every ingest
     * (cursor always at the newest data).
     *
     * When followIngest=false, _cursorOffset stays pinned. New data fills in
     * at the head; the cursor remains at the same logical position from tail
     * so the visible window is pinned to the same portion of the trace.
     * Once the ring wraps, tail advances and the window slides forward.
     *
     * Uses sentinel -1 for "not explicitly moved"; readDisplayWindow treats it as len.
     */
    private _cursorOffset = -1;

    /**
     * When true (default), the display cursor snaps to the newest data
     * after every ingest — the window always shows live data.
     * When false, the cursor stays where you put it (decoupled / scroll mode).
     */
    followIngest = true;

    // ── Scale hysteresis (Schmitt trigger, updated on getLatestWindow) ──

    private _hysteresisTier: ScaleTier = "ma";
    private _hysteresisDownTimer = 0;
    private _hysteresisLastMs = 0;

    /** Latest computed scale tier, updated during getLatestWindow. */
    get scaleTier(): ScaleTier { return this._hysteresisTier; }

    /** Reset hysteresis back to default. */
    resetHysteresis(): void {
        this._hysteresisTier = "ma";
        this._hysteresisDownTimer = 0;
        this._hysteresisLastMs = 0;
    }

    private parser: PacketParser;
    private simulator: Simulator | null = null;

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
        this.ring = new TelemetryRingBuffer(capacity, {
            trackExtremes: { current: { peak: true, min: true, max: true } },
        });
        this._createDisplayRings(displayCapacity, avgWindowSize);
        this.parser = new PacketParser();
        this.integrator = new DualStageIntegrator();
        this.extremes = new ExtremesTracker();
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
        this._createDisplayRings(displayCapacity, avgWindowSize);
        this._cursorOffset = -1;

        // Replay existing raw data into the new display rings
        this._replayRawRing();
    }



    get avgWindowSize(): number { return this._avgWindowSize; }
    get displayCapacity(): number { return this._displayCapacity; }

    // ── Display cursor ──

    /** Resolve the effective cursor offset. Sentinel -1 = always at end. */
    private _effectiveOffset(): number {
        const len = this._displayMeanRing.length;
        if (len === 0) return 0;
        if (this._cursorOffset < 0) return len;
        return Math.min(this._cursorOffset, len);
    }

    /** Move cursor to the newest data (offset = len, i.e. at head). */
    setCursorToEnd(): void {
        this._cursorOffset = this._displayMeanRing.length;
    }

    /**
     * Move cursor to a fraction of the display ring: 0.0 = oldest, 1.0 = newest.
     */
    setCursorToFraction(f: number): void {
        const len = this._displayMeanRing.length;
        if (len === 0) { this._cursorOffset = 0; return; }
        const clamped = Math.max(0, Math.min(1, f));
        this._cursorOffset = Math.round(clamped * len);
    }

    /** Current cursor position as a fraction [0, 1]. 1 = newest. */
    getCursorFraction(): number {
        const len = this._displayMeanRing.length;
        const off = this._effectiveOffset();
        return len > 0 ? off / len : 0;
    }

    // ── Reading from display rings ──

    /**
     * Read up to `count` display buckets ending at the cursor position.
     * Cursor is clamped to [0, len]. Sentinel -1 defaults to len (newest).
     * Returns points in chronological order.
     */
    readDisplayWindow(count: number): BucketedTelemetryData {
        if (count <= 0) return this._emptyBuckets();
        const len = this._displayMeanRing.length;
        if (len === 0) return this._emptyBuckets();

        const cursor = this._effectiveOffset();
        const start = Math.max(0, cursor - count);
        if (start >= cursor) return this._emptyBuckets();

        return this._sliceDisplay(start, cursor);
    }

    /**
     * Read the latest `count` display buckets.
     * When followIngest=true: snaps cursor to end first (always live).
     * When followIngest=false: reads from current cursor position (pinned).
     *
     * Also updates the scale hysteresis using the ring's cached peak current.
     */
    getLatestWindow(count: number): BucketedTelemetryData {
        if (this.followIngest) {
            this.setCursorToEnd();
        }

        // Update scale hysteresis with real wall-clock delta
        const now = performance.now();
        const deltaMs = this._hysteresisLastMs > 0 ? now - this._hysteresisLastMs : 16;
        const updated = updateScaleDelta(
            { tier: this._hysteresisTier, downTimer: this._hysteresisDownTimer },
            this.ring.peakCurrent,
            deltaMs,
        );
        this._hysteresisTier = updated.tier;
        this._hysteresisDownTimer = updated.downTimer;
        this._hysteresisLastMs = now;

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
        this.stopSimulate();
    }

    clear(): void {
        this.ring.clear();
        this._displayMaxRing.clear();
        this._displayMeanRing.clear();
        this._displayMinRing.clear();
        this._cursorOffset = -1;
        this.parser.reset();
        this.integrator.reset();
        this.extremes.reset();
        this.resetHysteresis();
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
        this.simulator = new Simulator(1000, 10, 0.5);
        this.mode = "simulate";
        this.running = true;
        this.simulator.startLoop((pkt) => this._ingestDecodedPacket(pkt));
    }

    stopSimulate(): void {
        this.simulator?.stopLoop();
        this.simulator = null;
        if (this.mode === "simulate") {
            this.mode = "idle";
            this.running = false;
        }
    }

    // ── Data ingestion ──

    /** Push a single (timestamp, voltage, current) sample directly. */
    pushSample(tsUs: number, voltage: number, current: number): void {
        this.ingestSample(tsUs, voltage, current);
    }

    pushSerialData(data: Uint8Array): void {
        for (const pkt of this.parser.push(data)) {
            this._ingestDecodedPacket(pkt);
        }
    }

    // ── Internal ──

    /** Ingest a decoded packet, distributing samples across the packet's duration. */
    private _ingestDecodedPacket(pkt: import("../decode/decode").DecodedPacket): void {
        this.deltaBetweenPackets = pkt.timestampUs - this.lastPacketTS;
        this.lastPacketTS = pkt.timestampUs;
        const dt = this.deltaBetweenPackets / pkt.samples.length;
        let ts = pkt.timestampUs - this.deltaBetweenPackets;
        for (const s of pkt.samples) {
            this.ingestSample(ts + dt, s.volts, s.amps);
            ts += dt;
        }
    }

    private ingestSample(tsUs: number, voltage: number, current: number): void {
        const adjustedTs = BigInt(tsUs) - BigInt(this.tZeroOffset);
        this.ring.push(adjustedTs, voltage, current);
        this.integrator.push(adjustedTs, voltage, current);
        this.extremes.push(adjustedTs, voltage, current);
        this._pushToDisplayRings(adjustedTs, voltage, current);
        this.sampleCount++;
        this.pktCountSinceStatus++;

        // Advance cursor to head when following live; otherwise clamp to valid range
        if (this.followIngest) {
            this._cursorOffset = this._displayMeanRing.length;
        } else if (this._cursorOffset >= 0) {
            this._cursorOffset = Math.min(this._cursorOffset, this._displayMeanRing.length);
        }
    }

    /** Push a single sample through the averaging pipeline into the display rings. */
    private _pushToDisplayRings(ts: bigint, v: number, i: number): void {
        if (this._avgWindowSize === 1) {
            this._displayMaxRing.push(ts, v, i);
            this._displayMeanRing.push(ts, v, i);
            this._displayMinRing.push(ts, v, i);
            return;
        }

        if (!this._displayTempRing) return;
        this._displayTempRing.push(ts, v, i);
        if (this._displayTempRing.length < this._avgWindowSize) return;

        const lastTs = this._displayTempRing.timestamps[this._displayTempRing.lastIdx];
        const bucketedV = calculateBuckets(this._displayTempRing.voltages, 1, this.avgMode)[0];
        const bucketedI = calculateBuckets(this._displayTempRing.currents, 1, this.avgMode)[0];
        this._displayMaxRing.push(lastTs, bucketedV.max, bucketedI.max);
        this._displayMeanRing.push(lastTs, bucketedV.avg, bucketedI.avg);
        this._displayMinRing.push(lastTs, bucketedV.min, bucketedI.min);
        this._displayTempRing.clear();
    }

    /** Slice the logical range [start, end) across all three display rings into a BucketedTelemetryData. */
    private _sliceDisplay(start: number, end: number): BucketedTelemetryData {
        return sliceDisplay(this._displayMaxRing, this._displayMeanRing, this._displayMinRing, start, end);
    }

    /** Create the three display rings and optional temp ring with standard options. */
    private _createDisplayRings(capacity: number, avgWindowSize: number): void {
        this._displayMaxRing = new TelemetryRingBuffer(capacity, {
            trackExtremes: { current: { max: true } },
        });
        this._displayMeanRing = new TelemetryRingBuffer(capacity);
        this._displayMinRing = new TelemetryRingBuffer(capacity, {
            trackExtremes: { current: { min: true } },
        });
        this._displayTempRing = avgWindowSize > 1 ? new TelemetryRingBuffer(avgWindowSize) : null;
    }

    /** Walk the raw ring and re-populate display rings. Call after creating new display rings. */
    private _replayRawRing(): void {
        const len = this.ring.length;
        if (len === 0) return;
        const tail = this.ring.tailIdx;
        const cap = this.ring.capacity;
        for (let i = 0; i < len; i++) {
            const idx = (tail + i) % cap;
            this._pushToDisplayRings(
                this.ring.timestamps[idx],
                this.ring.voltages[idx],
                this.ring.currents[idx],
            );
        }
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
        const lastIdx = this.ring.lastIdx;
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

    /** Peak current across the entire ring buffer (used for hysteresis). Uses cached ring value. */
    computePeakCurrent(): number {
        return this.ring.peakCurrent;
    }

    getExtremes(): { minV: number; maxV: number; minI: number; maxI: number } {
        return this.extremes.getExtremes();
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
