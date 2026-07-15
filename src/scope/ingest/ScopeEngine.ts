// Single-threaded scope engine.
// Owns the ring buffer, packet parser, integrator, and simulator.
// Replaces the Web Worker design — called directly from the main thread.

import { PacketParser } from "../decode/decode";
import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";
import { calculateBuckets } from "../lib/bucket";
import { DualStageIntegrator, integrateRange } from "../lib/integrator";
import { ExtremesTracker } from "../lib/extremesTracker";
import { sliceDisplay } from "../format/sliceDisplay";
import { updateScaleDelta, type ScaleTier } from "../lib/hysteresis";
import type { BucketedTelemetryData, StatusPayload } from "../types/workerTypes";


export class ScopeEngine {
    readonly ring: TelemetryRingBuffer;
    readonly integrator: DualStageIntegrator;
    readonly extremes: ExtremesTracker;
    avgMode: "simple" | "lttb" = "simple";
    /** Expected interval between observations (µs). Used for zero-stub timestamp spacing. */
    sampleIntervalUs: number = 100; // default 100µs = 10 kHz
    /** When true (default), short display windows get zero-padded stubs so the trace edge stays stable. */
    zeroPadEnabled: boolean = true;

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

    /** Cursor position as fraction [0,1] of the display ring. 0 = tail, 1 = head. */
    private _readCursor = 1;

    private _followIngest = true;

    /**
     * When true (default), the cursor auto-advances at the same rate as ingest
     * so the visible window stays locked to a fixed time offset from the live
     * head.  Only meaningful when followIngest=false.
     */
    private _cursorLocked = true;
    get cursorLocked(): boolean { return this._cursorLocked; }
    set cursorLocked(v: boolean) {
        this._cursorLocked = v;
        if (v && !this._followIngest) {
            this._refreshLockOffset();
        }
    }
    /** Distance in raw samples from cursor right edge to logical data-start. -1 = unset. */
    private _lockOffset = -1;

    /**
     * When true (default), ingestion pushes samples through to the display rings
     * and cursor is at 1 (latest). When set to false, the display rings freeze.
     * When re-enabled, the display rings are rebuilt from the raw ring and cursor
     * snaps back to 1.
     */
    get followIngest(): boolean { return this._followIngest; }
    set followIngest(v: boolean) {
        if (this._followIngest === v) return;
        this._followIngest = v;
        if (v) {
            this._displayMaxRing.clear();
            this._displayMeanRing.clear();
            this._displayMinRing.clear();
            this._readCursor = 1;
            this._lockOffset = -1;
            this._replayRawRing();
        } else if (this._cursorLocked) {
            this._refreshLockOffset();
        }
    }

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
    private _simWorker: Worker | null = null;

    // Simulator timestamp continuity across stop/start
    private _simSavedTUs = 0;
    private _simSavedWallPerfMs = 0;

    running = false;
    /** When true, ingestion (serial data, pushSample) is skipped but graph rendering continues. */
    ingestingPaused = false;
    mode: "idle" | "serial" | "simulate" = "idle";
    samplesPerSec = 0;
    sampleCount = 0; // observations pushed into ring
    private _rateAccumStart = 0;
    private _rateAccumCount = 0; // total raw samples received (for rate)
    tZeroOffset = 0;
    lastPacketTS = 0; // last raw packet timestamp ingested
    deltaBetweenPackets = 0; // time between last two packets (us)
    expectedSamplesPerPacket = 100;
    packetSmoothing = -1; // -1 = smooth entire packet
    onPacketWarning: ((msg: string) => void) | null = null;
    private _lastPacketWarning: string | null = null;

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
        this._rateAccumStart = performance.now();
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
        this._readCursor = 1;

        // Replay existing raw data into the new display rings
        this._replayRawRing();
    }



    get avgWindowSize(): number { return this._avgWindowSize; }
    get displayCapacity(): number { return this._displayCapacity; }

    // ── Display cursor (fraction [0,1] over the display ring) ──
    setCursorToFraction(f: number): void {
        this._readCursor = Math.max(0, Math.min(1, f));
        if (this.cursorLocked) {
            this._refreshLockOffset();
        }
    }

    getCursorFraction(): number {
        return this._readCursor;
    }

    // ── Reading from display rings ──

    /**
     * Read up to `count` display buckets relative to `_readCursor`.
     * +ve count = read from cursor leftward (toward tail / older data).
     * -ve count = read from cursor rightward (toward head / newer data).
     *
     * When the display ring has fewer than `count` items in the requested
     * direction, the leading (or trailing) slots are zero-padded with
     * properly-spaced timestamps so the trace edge stays stable.
     *
     * @param count  Number of buckets. +ve = leftward from cursor, -ve = rightward.
     * @param pad    Optional override for zero-padding. `true` = pad, `false` = no pad,
     *               omitted = use `zeroPadEnabled`. Defaults to `zeroPadEnabled`.
     * Returns points in chronological order.
     */
    readDisplayWindow(count: number, pad?: boolean): BucketedTelemetryData {
        if (count === 0) return this._emptyBuckets();

        if (!this._followIngest) {
            return this._readFromRawRing(count, pad);
        }

        const len = this._displayMeanRing.length;
        if (len === 0) return this._emptyBuckets();

        // Ingest-following mode: cursor is at 1 (head), read from display ring
        if (count > 0) {
            const start = Math.max(0, len - count);
            const realCount = len - start;
            const missing = count - realCount;
            if (missing <= 0) {
                return this._sliceDisplay(start, len);
            }
            return this._padLeft(this._sliceDisplay(start, len), missing, realCount, pad ?? this.zeroPadEnabled);
        }

        const absCount = -count;
        const end = Math.min(absCount, len);
        const realCount = end;
        const missing = absCount - realCount;
        if (missing <= 0) {
            return this._sliceDisplay(0, end);
        }
        return this._padRight(this._sliceDisplay(0, end), missing, realCount, pad ?? this.zeroPadEnabled);
    }

    /**
     * Read the latest `count` display buckets.
     * When followIngest=true: snaps cursor to end first (always live).
     * When followIngest=false: reads from current cursor position (pinned).
     *
     * Also updates the scale hysteresis using the ring's cached peak current.
     */
    getLatestWindow(count: number, pad?: boolean): BucketedTelemetryData {
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

        return this.readDisplayWindow(count, pad);
    }

    /** Integrate a range of the raw ring buffer. */
    getIntegration(
        startTs: bigint,
        endTs: bigint,
    ): import("../lib/integrator").IntegrationResult {
        return integrateRange(this.ring, startTs, endTs);
    }

    /** Current dual-stage integrator totals (session energy & charge). */
    getSessionTotals(): { energyJ: number; chargeC: number } {
        return this.integrator.getTotals();
    }

    // ── Actions ──

    start(): void {
        this.running = true;
        this.ingestingPaused = false;
    }

    pause(): void {
        this.running = false;
        this.ingestingPaused = true;
        this.stopSimulate();
    }

    clear(): void {
        this.ring.clear();
        this._displayMaxRing.clear();
        this._displayMeanRing.clear();
        this._displayMinRing.clear();
        this._readCursor = 1;
        this._lockOffset = -1;
        this.parser.reset();
        this.integrator.reset();
        this.extremes.reset();
        this.resetHysteresis();
        this.tZeroOffset = 0;
        this.sampleCount = 0;
        this.samplesPerSec = 0;
        this._rateAccumCount = 0;
        this._rateAccumStart = 0;
        this._lastPacketWarning = null;
        this._simSavedTUs = 0;
        this._simSavedWallPerfMs = 0;
    }

    disconnect(): void {
        this.running = false;
        this.mode = "idle";
        this.parser.reset();
        this.tZeroOffset = 0;
    }

    startSimulate(): void {
        this.mode = "simulate";
        this.running = true;
        this._simWorker = new Worker(
            new URL("./simulateWorker.ts", import.meta.url),
            { type: "module" },
        );
        this._simWorker.onmessage = (e) => {
            if (e.data.type === "packets") {
                for (const pkt of e.data.packets) {
                    this._ingestDecodedPacket(pkt);
                }
            }
        };
        this._simWorker.postMessage({
            type: "start",
            savedTUs: this._simSavedTUs,
            savedWallMs: this._simSavedWallPerfMs,
            nowPerf: performance.now(),
        });
    }

    stopSimulate(): void {
        if (this._simWorker) {
            // Save engine-side timestamp before destroying the worker.
            // lastPacketTS is the last received packet timestamp; the worker's
            // internal tUs will be ~1000µs ahead, which is negligible for phase continuity.
            this._simSavedTUs = this.lastPacketTS;
            this._simSavedWallPerfMs = performance.now();
            this._simWorker.terminate();
            this._simWorker = null;
        }
        if (this.mode === "simulate") {
            this.mode = "idle";
            this.running = false;
        }
    }

    // ── Data ingestion ──

    /** Push a single (timestamp, voltage, current) observation directly. */
    pushSample(tsUs: number, voltage: number, current: number): void {
        if (this.ingestingPaused) return;
        this.ingestObservation(tsUs, voltage, current);
    }

    pushSerialData(data: Uint8Array): void {
        if (this.ingestingPaused) return;
        for (const pkt of this.parser.push(data)) {
            this._ingestDecodedPacket(pkt);
        }
    }

    // ── Internal ──

    /** Ingest a decoded packet, averaging samples into observations. */
    private _ingestDecodedPacket(pkt: import("../decode/decode").DecodedPacket): void {
        this.deltaBetweenPackets = pkt.timestampUs - this.lastPacketTS;
        this.lastPacketTS = pkt.timestampUs;

        // Check for undersized packet
        if (pkt.samples.length < this.expectedSamplesPerPacket) {
            const msg = `Packet too small: got ${pkt.samples.length} samples, expected ≥ ${this.expectedSamplesPerPacket}`;
            this._lastPacketWarning = msg;
            this.onPacketWarning?.(msg);
        }

        if (pkt.samples.length === 0) return;

        const groupSize = this.packetSmoothing === -1
            ? pkt.samples.length
            : this.packetSmoothing;

        const dt = this.deltaBetweenPackets / pkt.samples.length;

        // Average raw samples into observations
        let accV = 0, accI = 0, accCount = 0;
        // ts = first sample time in current group
        let groupFirstTs = pkt.timestampUs - this.deltaBetweenPackets + dt;
        // Sample k (0-indexed) gets time = pkt.timestampUs - this.deltaBetweenPackets + (k+1) * dt
        for (let i = 0; i < pkt.samples.length; i++) {
            const s = pkt.samples[i];
            accV += s.volts;
            accI += s.amps;
            accCount++;
            this._rateAccumCount++;
            const tEnd = pkt.timestampUs - this.deltaBetweenPackets + (i + 1) * dt;

            if (accCount >= groupSize) {
                this.ingestObservation((groupFirstTs + tEnd) / 2, accV / accCount, accI / accCount);
                accV = 0; accI = 0; accCount = 0;
                // Next group starts at the NEXT sample's time
                groupFirstTs = pkt.timestampUs - this.deltaBetweenPackets + (i + 2) * dt;
            }
        }
        // Flush remaining partial group
        if (accCount > 0) {
            const lastTs = pkt.timestampUs - this.deltaBetweenPackets + pkt.samples.length * dt;
            this.ingestObservation((groupFirstTs + lastTs) / 2, accV / accCount, accI / accCount);
        }
    }

    private ingestObservation(tsUs: number, voltage: number, current: number): void {
        const rawTs = BigInt(Math.round(tsUs));
        this.ring.push(rawTs, voltage, current);
        this.integrator.push(rawTs, voltage, current);
        this.extremes.push(rawTs, voltage, current);
        if (this._followIngest) {
            this._pushToDisplayRings(rawTs, voltage, current);
        } else if (this.cursorLocked && this._lockOffset >= 0) {
            // Slide cursor left so offset from data-start stays constant
            const cap = this.ring.capacity;
            const len = this.ring.length;
            const dataStart = len < cap ? cap - len : 0;
            const targetPos = Math.max(dataStart, dataStart + this._lockOffset);
            this._readCursor = Math.min(1, targetPos / cap);
        }
        this.sampleCount++;
        this._rateAccumCount++;
    }

    /**
     * Read `count` display buckets from the raw ring. The right edge of the
     * window is at `_readCursor` fraction of the raw ring's logical buffer.
     * +ve count = leftward from cursor (older), -ve = rightward (newer).
     */
    private _readFromRawRing(count: number, pad?: boolean): BucketedTelemetryData {
        const rawCap = this.ring.capacity;
        const rawLen = this.ring.length;
        const tail = this.ring.tailIdx;
        const avgSz = this._avgWindowSize;
        const absCount = Math.abs(count);
        const totalSamples = absCount * avgSz;

        // Right edge of the window, rounded to a raw sample index
        const logicalEnd = Math.round(this._readCursor * rawCap);
        if (logicalEnd <= 0) return this._emptyBuckets();
        if (logicalEnd > rawCap) return this._emptyBuckets();

        // Data occupies the rightmost portion of the logical buffer when not full
        const dataStart = rawLen < rawCap ? rawCap - rawLen : 0;

        if (count > 0) {
            // Read `count` buckets leftward from cursor (older data)
            const logicalStart = logicalEnd - totalSamples;
            if (logicalStart < dataStart) {
                // Window extends into empty region — clamp
                const availableSamples = logicalEnd - dataStart;
                if (availableSamples <= 0) return this._emptyBuckets();
                const availableBuckets = Math.floor(availableSamples / avgSz);
                if (availableBuckets <= 0) return this._emptyBuckets();
                return this._readFromRawRing(Math.min(count, availableBuckets), pad);
            }

            const timestamps = new Float64Array(absCount);
            const avgV = new Float32Array(absCount);
            const minV = new Float32Array(absCount);
            const maxV = new Float32Array(absCount);
            const avgI = new Float32Array(absCount);
            const minI = new Float32Array(absCount);
            const maxI = new Float32Array(absCount);

            // Map logicalStart to physical index
            const p = rawLen < rawCap ? logicalStart - dataStart : (tail + logicalStart) % rawCap;

            for (let d = 0; d < absCount; d++) {
                const baseIdx = (p + d * avgSz) % rawCap;
                let sumV = 0, sumI = 0;
                let minVv = Infinity, maxVv = -Infinity;
                let minIi = Infinity, maxIi = -Infinity;

                for (let j = 0; j < avgSz; j++) {
                    const idx = (baseIdx + j) % rawCap;
                    const v = this.ring.voltages[idx];
                    const i = this.ring.currents[idx];
                    sumV += v;
                    sumI += i;
                    if (v < minVv) minVv = v;
                    if (v > maxVv) maxVv = v;
                    if (i < minIi) minIi = i;
                    if (i > maxIi) maxIi = i;
                }

                timestamps[d] = Number(this.ring.timestamps[baseIdx]) - this.tZeroOffset;
                avgV[d] = sumV / avgSz;
                minV[d] = minVv;
                maxV[d] = maxVv;
                avgI[d] = sumI / avgSz;
                minI[d] = minIi;
                maxI[d] = maxIi;
            }

            return { timestamps, avgV, minV, maxV, avgI, minI, maxI };
        }

        // ── Negative count: read rightward from cursor ──
        const logicalStart = logicalEnd;
        const logicalStop = logicalStart + totalSamples;
        if (logicalStop > rawCap) {
            // Past head — clamp
            const availableSamples = rawCap - logicalStart;
            if (availableSamples <= 0) return this._emptyBuckets();
            const availableBuckets = Math.floor(availableSamples / avgSz);
            if (availableBuckets <= 0) return this._emptyBuckets();
            return this._readFromRawRing(-availableBuckets, pad);
        }

        const timestamps = new Float64Array(absCount);
        const avgV = new Float32Array(absCount);
        const minV = new Float32Array(absCount);
        const maxV = new Float32Array(absCount);
        const avgI = new Float32Array(absCount);
        const minI = new Float32Array(absCount);
        const maxI = new Float32Array(absCount);

        const p = rawLen < rawCap ? logicalStart - dataStart : (tail + logicalStart) % rawCap;

        for (let d = 0; d < absCount; d++) {
            const baseIdx = (p + d * avgSz) % rawCap;
            let sumV = 0, sumI = 0;
            let minVv = Infinity, maxVv = -Infinity;
            let minIi = Infinity, maxIi = -Infinity;

            for (let j = 0; j < avgSz; j++) {
                const idx = (baseIdx + j) % rawCap;
                const v = this.ring.voltages[idx];
                const i = this.ring.currents[idx];
                sumV += v;
                sumI += i;
                if (v < minVv) minVv = v;
                if (v > maxVv) maxVv = v;
                if (i < minIi) minIi = i;
                if (i > maxIi) maxIi = i;
            }

            timestamps[d] = Number(this.ring.timestamps[baseIdx]) - this.tZeroOffset;
            avgV[d] = sumV / avgSz;
            minV[d] = minVv;
            maxV[d] = maxVv;
            avgI[d] = sumI / avgSz;
            minI[d] = minIi;
            maxI[d] = maxIi;
        }

        return { timestamps, avgV, minV, maxV, avgI, minI, maxI };
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
        return sliceDisplay(this._displayMaxRing, this._displayMeanRing, this._displayMinRing, start, end, this.tZeroOffset);
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

        // Smooth samples/s over ~500ms to avoid jitter
        if (this._rateAccumStart === 0) this._rateAccumStart = now;
        const dtMs = now - this._rateAccumStart;
        if (dtMs >= 500) {
            this.samplesPerSec = Math.round((this._rateAccumCount / dtMs) * 1000);
            this._rateAccumStart = now;
            this._rateAccumCount = 0;
        }

        const len = this.ring.length;
        const lastIdx = this.ring.lastIdx;
        const liveV = len > 0 ? this.ring.voltages[lastIdx] : 0;
        const liveI = len > 0 ? this.ring.currents[lastIdx] : 0;

        const pw = this._lastPacketWarning;
        this._lastPacketWarning = null;

        return {
            running: this.running,
            mode: this.mode,
            samplesPerSec: this.samplesPerSec,
            observationCount: this.sampleCount,
            bufferFillPct: this.ring.fillPct,
            liveV,
            liveI,
            liveW: liveV * liveI,
            lastTimestampUs: len > 0 ? Number(this.ring.timestamps[lastIdx]) : 0,
            packetWarning: pw,
        };
    }

    /** Peak current across the entire ring buffer (used for hysteresis). Uses cached ring value. */
    computePeakCurrent(): number {
        return this.ring.peakCurrent;
    }

    getExtremes(): { minV: number; maxV: number; minI: number; maxI: number } {
        return this.extremes.getExtremes();
    }

    // ── Zero-padding helpers ──

    /** Prepend `missing` zero-value stubs before real data (positive-count mode). */
    private _padLeft(data: BucketedTelemetryData, missing: number, realCount: number, pad: boolean): BucketedTelemetryData {
        if (!pad) {
            return data;
        }

        const spacing = realCount > 1
            ? (data.timestamps[realCount - 1] - data.timestamps[0]) / (realCount - 1)
            : this.sampleIntervalUs;

        const firstRealTs = data.timestamps[0] + this.tZeroOffset;
        const stubTimestamps = new Float64Array(missing);
        const stubZeros = new Float32Array(missing);
        for (let i = 0; i < missing; i++) {
            stubTimestamps[i] = firstRealTs - (missing - i) * spacing - this.tZeroOffset;
        }

        return {
            timestamps: concatFloat64(stubTimestamps, data.timestamps),
            avgV: concatFloat32(stubZeros, data.avgV),
            minV: concatFloat32(stubZeros, data.minV),
            maxV: concatFloat32(stubZeros, data.maxV),
            avgI: concatFloat32(stubZeros, data.avgI),
            minI: concatFloat32(stubZeros, data.minI),
            maxI: concatFloat32(stubZeros, data.maxI),
        };
    }

    /** Append `missing` zero-value stubs after real data (negative-count mode). */
    private _padRight(data: BucketedTelemetryData, missing: number, realCount: number, pad: boolean): BucketedTelemetryData {
        if (!pad) {
            return data;
        }

        const spacing = realCount > 1
            ? (data.timestamps[realCount - 1] - data.timestamps[0]) / (realCount - 1)
            : this.sampleIntervalUs;

        const lastRealTs = data.timestamps[realCount - 1] + this.tZeroOffset;
        const stubTimestamps = new Float64Array(missing);
        const stubZeros = new Float32Array(missing);
        for (let i = 0; i < missing; i++) {
            stubTimestamps[i] = lastRealTs + (i + 1) * spacing - this.tZeroOffset;
        }

        return {
            timestamps: concatFloat64(data.timestamps, stubTimestamps),
            avgV: concatFloat32(data.avgV, stubZeros),
            minV: concatFloat32(data.minV, stubZeros),
            maxV: concatFloat32(data.maxV, stubZeros),
            avgI: concatFloat32(data.avgI, stubZeros),
            minI: concatFloat32(data.minI, stubZeros),
            maxI: concatFloat32(data.maxI, stubZeros),
        };
    }

    // ── Helpers ──

    /** Recompute _lockOffset from current cursor position (offset from data-start). */
    private _refreshLockOffset(): void {
        const cap = this.ring.capacity;
        const len = this.ring.length;
        const pos = Math.round(this._readCursor * cap);
        const dataStart = len < cap ? cap - len : 0;
        this._lockOffset = Math.max(0, pos - dataStart);
    }

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

// ── Typed array concatenation helpers ──

function concatFloat64(a: Float64Array, b: Float64Array): Float64Array {
    const out = new Float64Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
