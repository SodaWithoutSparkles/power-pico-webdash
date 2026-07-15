// Pure function to combine three parallel display rings into a single BucketedTelemetryData.
import type { BucketedTelemetryData } from "../types/workerTypes";

/**
 * Slice the logical range [start, end) across three display rings (max/mean/min)
 * into a single BucketedTelemetryData. All three rings must share the same capacity
 * and tailIdx (same push pattern).
 */
export function sliceDisplay(
    maxRing: { voltages: Float32Array; currents: Float32Array; capacity: number; tailIdx: number },
    meanRing: { timestamps: BigInt64Array; voltages: Float32Array; currents: Float32Array; capacity: number; tailIdx: number },
    minRing: { voltages: Float32Array; currents: Float32Array; capacity: number; tailIdx: number },
    start: number,
    end: number,
    tZeroOffset = 0,
): BucketedTelemetryData {
    const count = end - start;
    const cap = meanRing.capacity;
    const tail = meanRing.tailIdx;

    const timestamps = new Float64Array(count);
    const avgV = new Float32Array(count);
    const minV = new Float32Array(count);
    const maxV = new Float32Array(count);
    const avgI = new Float32Array(count);
    const minI = new Float32Array(count);
    const maxI = new Float32Array(count);

    const offset = Math.round(tZeroOffset);
    for (let i = 0; i < count; i++) {
        const idx = (tail + start + i) % cap;
        timestamps[i] = Number(meanRing.timestamps[idx]) - offset;
        avgV[i] = meanRing.voltages[idx];
        avgI[i] = meanRing.currents[idx];
        maxV[i] = maxRing.voltages[idx];
        maxI[i] = maxRing.currents[idx];
        minV[i] = minRing.voltages[idx];
        minI[i] = minRing.currents[idx];
    }

    return { timestamps, avgV, minV, maxV, avgI, minI, maxI };
}
