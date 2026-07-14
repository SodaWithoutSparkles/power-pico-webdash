// Min-max bucketing format engine.
// Converts raw ring buffer data into bucketed averages + min/max for display.

import { TelemetryRingBuffer } from "./TelemetryRingBuffer";
import type { BucketedTelemetryData } from "./workerTypes";

/**
 * Bucket the range [startTs, endTs) into `bucketCount` slices.
 * Each bucket produces avg/min/max for V and I, plus a midpoint timestamp.
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

    const buckets = Math.min(bucketCount, totalCount);
    const timestamps = new Float64Array(buckets);
    const avgV = new Float32Array(buckets);
    const minV = new Float32Array(buckets);
    const maxV = new Float32Array(buckets);
    const avgI = new Float32Array(buckets);
    const minI = new Float32Array(buckets);
    const maxI = new Float32Array(buckets);

    const samplesPerBucket = Math.max(1, Math.floor(totalCount / buckets));
    let outIdx = 0;
    let currentRingIdx = startIdx;
    let remaining = totalCount;

    while (remaining > 0 && outIdx < buckets) {
        const take = Math.min(samplesPerBucket, remaining);
        let sumV = 0;
        let sumI = 0;
        let mnV = Infinity;
        let mxV = -Infinity;
        let mnI = Infinity;
        let mxI = -Infinity;
        let tsSum = 0n;
        let tsCount = 0;

        for (let i = 0; i < take; i++) {
            const v = ring.voltages[currentRingIdx];
            const iVal = ring.currents[currentRingIdx];
            sumV += v;
            sumI += iVal;
            if (v < mnV) mnV = v;
            if (v > mxV) mxV = v;
            if (iVal < mnI) mnI = iVal;
            if (iVal > mxI) mxI = iVal;
            tsSum += ring.timestamps[currentRingIdx];
            tsCount++;
            currentRingIdx = (currentRingIdx + 1) % ring.capacity;
        }

        timestamps[outIdx] = Number(tsSum / BigInt(tsCount));
        avgV[outIdx] = sumV / take;
        minV[outIdx] = mnV === Infinity ? 0 : mnV;
        maxV[outIdx] = mxV === -Infinity ? 0 : mxV;
        avgI[outIdx] = sumI / take;
        minI[outIdx] = mnI === Infinity ? 0 : mnI;
        maxI[outIdx] = mxI === -Infinity ? 0 : mxI;

        outIdx++;
        remaining -= take;
    }

    // Trim if we allocated more than needed
    if (outIdx < buckets) {
        return {
            timestamps: timestamps.subarray(0, outIdx) as Float64Array,
            avgV: avgV.subarray(0, outIdx) as Float32Array,
            minV: minV.subarray(0, outIdx) as Float32Array,
            maxV: maxV.subarray(0, outIdx) as Float32Array,
            avgI: avgI.subarray(0, outIdx) as Float32Array,
            minI: minI.subarray(0, outIdx) as Float32Array,
            maxI: maxI.subarray(0, outIdx) as Float32Array,
        };
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
