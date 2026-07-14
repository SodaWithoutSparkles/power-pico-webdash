// Min-max bucketing format engine.
// Converts raw ring buffer data into bucketed averages + min/max for display.

import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";
import { computeBucketRanges } from "../lib/bucket";
import type { BucketedTelemetryData } from "../types/workerTypes";

/**
 * Bucket the range [startTs, endTs) into `bucketCount` slices.
 * Each bucket produces avg/min/max for V and I, plus a midpoint timestamp.
 *
 * Uses computeBucketRanges from the shared bucket lib for boundary logic.
 */
export function bucketData(
    ring: TelemetryRingBuffer,
    startTs: bigint,
    endTs: bigint,
    bucketCount: number,
): BucketedTelemetryData {
    if (bucketCount <= 0) bucketCount = 1;
    const startIdx = ring.binarySearch(startTs);
    if (startIdx < 0) return _emptyBuckets(0);

    // Find end index: binarySearch returns first index >= endTs, or -1 if past end
    let endIdx = ring.binarySearch(endTs);
    if (endIdx < 0) {
        // past end — use head (exclusive) as the logical end
        endIdx = ring.headIdx;
    }
    const totalCount = ring.logicalCount(startIdx, endIdx);
    if (totalCount <= 0) return _emptyBuckets(0);

    const actualBuckets = Math.min(bucketCount, totalCount);
    const ranges = computeBucketRanges(totalCount, actualBuckets);
    const cap = ring.capacity;

    const timestamps = new Float64Array(actualBuckets);
    const avgV = new Float32Array(actualBuckets);
    const minV = new Float32Array(actualBuckets);
    const maxV = new Float32Array(actualBuckets);
    const avgI = new Float32Array(actualBuckets);
    const minI = new Float32Array(actualBuckets);
    const maxI = new Float32Array(actualBuckets);

    for (let b = 0; b < actualBuckets; b++) {
        const { start, end } = ranges[b];
        let sumV = 0;
        let sumI = 0;
        let mnV = Infinity;
        let mxV = -Infinity;
        let mnI = Infinity;
        let mxI = -Infinity;
        let tsSum = 0n;

        for (let j = start; j < end; j++) {
            const idx = (startIdx + j) % cap;
            const v = ring.voltages[idx];
            const iVal = ring.currents[idx];
            sumV += v;
            sumI += iVal;
            if (v < mnV) mnV = v;
            if (v > mxV) mxV = v;
            if (iVal < mnI) mnI = iVal;
            if (iVal > mxI) mxI = iVal;
            tsSum += ring.timestamps[idx];
        }

        const count = end - start;
        timestamps[b] = Number(tsSum / BigInt(count));
        avgV[b] = sumV / count;
        minV[b] = mnV === Infinity ? 0 : mnV;
        maxV[b] = mxV === -Infinity ? 0 : mxV;
        avgI[b] = sumI / count;
        minI[b] = mnI === Infinity ? 0 : mnI;
        maxI[b] = mxI === -Infinity ? 0 : mxI;
    }

    return { timestamps, avgV, minV, maxV, avgI, minI, maxI };
}

/**
 * Bucket data from `sinceTs` to the current head.
 * Convenience wrapper around bucketData.
 */
export function bucketDataSince(
    ring: TelemetryRingBuffer,
    sinceTs: bigint,
    bucketCount: number,
): BucketedTelemetryData {
    // Use the head timestamp as end
    const len = ring.length;
    if (len === 0) return _emptyBuckets(0);
    const headTs = ring.timestamps[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1];
    return bucketData(ring, sinceTs, headTs + 1n, bucketCount);
}

function _emptyBuckets(_bucketCount: number): BucketedTelemetryData {
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
