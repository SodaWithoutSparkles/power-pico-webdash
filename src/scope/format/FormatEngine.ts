// Format engine — owns the display-ring averaging pipeline.
// Converts raw samples → bucketed min/mean/max display data for the UI.
// Delegated to by ScopeEngine.

import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";
import { calculateBuckets } from "../lib/bucket";
import { sliceDisplay } from "./sliceDisplay";
import type { BucketedTelemetryData } from "../types/workerTypes";

export class FormatEngine {
    displayMaxRing: TelemetryRingBuffer;
    displayMeanRing: TelemetryRingBuffer;
    displayMinRing: TelemetryRingBuffer;
    private _displayTempRing: TelemetryRingBuffer | null = null;
    avgMode: "simple" | "lttb" = "simple";
    private _avgWindowSize: number;
    private _displayCapacity: number;

    constructor(displayCapacity: number, avgWindowSize: number) {
        this._avgWindowSize = avgWindowSize;
        this._displayCapacity = displayCapacity;
        this.displayMaxRing = new TelemetryRingBuffer(displayCapacity, {
            trackExtremes: { current: { max: true } },
        });
        this.displayMeanRing = new TelemetryRingBuffer(displayCapacity);
        this.displayMinRing = new TelemetryRingBuffer(displayCapacity, {
            trackExtremes: { current: { min: true } },
        });
        this._displayTempRing = avgWindowSize > 1 ? new TelemetryRingBuffer(avgWindowSize) : null;
    }

    get avgWindowSize(): number { return this._avgWindowSize; }
    get displayCapacity(): number { return this._displayCapacity; }

    /** Reconfigure display rings. Caller should replay raw data afterward. */
    setDisplayWindow(displayCapacity: number, avgWindowSize: number): void {
        this._avgWindowSize = avgWindowSize;
        this._displayCapacity = displayCapacity;
        this.displayMaxRing = new TelemetryRingBuffer(displayCapacity, {
            trackExtremes: { current: { max: true } },
        });
        this.displayMeanRing = new TelemetryRingBuffer(displayCapacity);
        this.displayMinRing = new TelemetryRingBuffer(displayCapacity, {
            trackExtremes: { current: { min: true } },
        });
        this._displayTempRing = avgWindowSize > 1 ? new TelemetryRingBuffer(avgWindowSize) : null;
    }

    // ── Averaging pipeline ──

    /** Push a single raw sample through the averaging pipeline into display rings. */
    pushToDisplay(ts: bigint, v: number, i: number): void {
        if (this._avgWindowSize === 1) {
            this.displayMaxRing.push(ts, v, i);
            this.displayMeanRing.push(ts, v, i);
            this.displayMinRing.push(ts, v, i);
            return;
        }

        if (!this._displayTempRing) return;
        this._displayTempRing.push(ts, v, i);
        if (this._displayTempRing.length < this._avgWindowSize) return;

        const lastTs = this._displayTempRing.timestamps[this._displayTempRing.lastIdx];
        const bucketedV = calculateBuckets(this._displayTempRing.voltages, 1, this.avgMode)[0];
        const bucketedI = calculateBuckets(this._displayTempRing.currents, 1, this.avgMode)[0];
        this.displayMaxRing.push(lastTs, bucketedV.max, bucketedI.max);
        this.displayMeanRing.push(lastTs, bucketedV.avg, bucketedI.avg);
        this.displayMinRing.push(lastTs, bucketedV.min, bucketedI.min);
        this._displayTempRing.clear();
    }

    /** Walk a raw ring and replay every sample through pushToDisplay. */
    replayRawRing(ring: TelemetryRingBuffer): void {
        const len = ring.length;
        if (len === 0) return;
        const tail = ring.tailIdx;
        const cap = ring.capacity;
        for (let i = 0; i < len; i++) {
            const idx = (tail + i) % cap;
            this.pushToDisplay(ring.timestamps[idx], ring.voltages[idx], ring.currents[idx]);
        }
    }

    /** Slice a logical range across all three display rings into a BucketedTelemetryData. */
    sliceDisplay(start: number, end: number, tZeroOffset: number): BucketedTelemetryData {
        return sliceDisplay(this.displayMaxRing, this.displayMeanRing, this.displayMinRing, start, end, tZeroOffset);
    }

    /** Clear all display rings. */
    clear(): void {
        this.displayMaxRing.clear();
        this.displayMeanRing.clear();
        this.displayMinRing.clear();
    }

    // ── Zero-padding ──

    /** Prepend `missing` zero-value stubs before real data (positive-count mode). */
    padLeft(
        data: BucketedTelemetryData,
        missing: number,
        realCount: number,
        sampleIntervalUs: number,
        tZeroOffset: number,
    ): BucketedTelemetryData {
        if (missing <= 0) return data;

        const spacing = realCount > 1
            ? (data.timestamps[realCount - 1] - data.timestamps[0]) / (realCount - 1)
            : sampleIntervalUs;

        const firstRealTs = data.timestamps[0] + tZeroOffset;
        const stubTimestamps = new Float64Array(missing);
        const stubZeros = new Float32Array(missing);
        for (let i = 0; i < missing; i++) {
            stubTimestamps[i] = firstRealTs - (missing - i) * spacing - tZeroOffset;
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
    padRight(
        data: BucketedTelemetryData,
        missing: number,
        realCount: number,
        sampleIntervalUs: number,
        tZeroOffset: number,
    ): BucketedTelemetryData {
        if (missing <= 0) return data;

        const spacing = realCount > 1
            ? (data.timestamps[realCount - 1] - data.timestamps[0]) / (realCount - 1)
            : sampleIntervalUs;

        const lastRealTs = data.timestamps[realCount - 1] + tZeroOffset;
        const stubTimestamps = new Float64Array(missing);
        const stubZeros = new Float32Array(missing);
        for (let i = 0; i < missing; i++) {
            stubTimestamps[i] = lastRealTs + (i + 1) * spacing - tZeroOffset;
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

    emptyBuckets(): BucketedTelemetryData {
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

export function concatFloat64(a: Float64Array, b: Float64Array): Float64Array {
    const out = new Float64Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

export function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
