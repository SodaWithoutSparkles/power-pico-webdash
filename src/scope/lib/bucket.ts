// Pure bucketing utilities for 1D numeric arrays.
// No deps. Works with any array-like of numbers (number[], Float64Array, etc.).

export interface BucketRange {
    /** Logical start index (inclusive) within the source. */
    start: number;
    /** Logical end index (exclusive) within the source. */
    end: number;
}

export interface SimpleBucket {
    /** Minimum value in the bucket. */
    min: number;
    /** Maximum value in the bucket. */
    max: number;
    /** Arithmetic mean of values in the bucket. */
    avg: number;
    /** Number of source samples in this bucket. */
    count: number;
}

/**
 * Split `totalCount` items into `bucketCount` approximately-equal logical ranges.
 * Uses fractional split with rounding so buckets with odd totals
 * are distributed evenly (not all remainder dumped in the last bucket).
 */
export function computeBucketRanges(
    totalCount: number,
    bucketCount: number,
): BucketRange[] {
    if (totalCount <= 0 || bucketCount <= 0) return [];
    const ranges: BucketRange[] = [];
    const samplesPerBucket = totalCount / bucketCount;
    let src = 0;
    for (let b = 0; b < bucketCount; b++) {
        const end = Math.min(Math.round((b + 1) * samplesPerBucket), totalCount);
        ranges.push({ start: src, end });
        src = end;
    }
    return ranges;
}


/**
 * Compute the ideal avgWindowSize (raw samples per display bucket) for a
 * given visible time span and target bucket count.
 *
 * When zoomed in (small `visibleTimeSpanUs` → fewer samples per bucket → higher resolution).
 * When zoomed out (large `visibleTimeSpanUs` → more samples per bucket → coarser resolution).
 *
 * Clamped to [1, 1000] to prevent pathological values.
 */
export function computeIdealAvgWindowSize(
    visibleTimeSpanUs: number,
    targetBucketCount: number,
    sampleIntervalUs: number,
): number {
    if (targetBucketCount <= 0 || sampleIntervalUs <= 0 || visibleTimeSpanUs <= 0) return 1;
    const usPerBucket = visibleTimeSpanUs / targetBucketCount;
    const samplesPerBucket = Math.round(usPerBucket / sampleIntervalUs);
    return Math.max(1, Math.min(1000, samplesPerBucket));
}

export function calculateBuckets(
    data: ArrayLike<number>,
    bucketCount: number,
    method: "simple" | "lttb" = "simple",
): SimpleBucket[] {
    if (method === "simple") {
        return simpleBuckets(data, bucketCount);
    } else if (method === "lttb") {
        const downsampled = lttbBuckets(data, bucketCount);
        return downsampled.map((v) => ({ min: v, max: v, avg: v, count: 1 }));
    } else {
        throw new Error(`Unknown bucketing method: ${method}`);
    }
}
/**
 * Divide `data` into `bucketCount` equal-sized buckets.
 * Each bucket reports min, max, avg, and sample count.
 *
 * If `bucketCount` exceeds data length, trailing buckets are empty (all zeros, count=0).
 */
function simpleBuckets(
    data: ArrayLike<number>,
    bucketCount: number,
): SimpleBucket[] {
    const n = data.length;
    if (n === 0 || bucketCount <= 0) return [];
    return computeBucketRanges(n, bucketCount).map(({ start, end }) => {
        if (start >= end) return { min: 0, max: 0, avg: 0, count: 0 };
        let sum = 0;
        let mn = data[start];
        let mx = data[start];
        for (let j = start; j < end; j++) {
            const v = data[j];
            sum += v;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        const count = end - start;
        return { min: mn, max: mx, avg: sum / count, count };
    });
}

/**
 * Lightweight Largest Triangle Three Buckets (LTTB) downsampling.
 *
 * Reduces `data` to `bucketCount` points while preserving visual shape
 * (peaks, valleys, edges). Uses array index as the x-position.
 *
 * Always includes the first and last elements of the input.
 * If `bucketCount >= data.length`, returns a copy of the original data.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual Representation"
 *            https://github.com/sveinn-steinarsson/flot-downsample
 */
function lttbBuckets(
    data: ArrayLike<number>,
    bucketCount: number,
): number[] {
    const n = data.length;
    if (n <= 2 || bucketCount >= n) {
        return Array.from(data);
    }

    const actual = Math.max(2, Math.min(bucketCount, n));
    const result: number[] = [data[0]];

    // Number of interior buckets (first & last are pinned)
    const interiorCount = actual - 2;
    if (interiorCount <= 0) {
        result.push(data[n - 1]);
        return result;
    }

    // Each interior bucket spans (n-2) / interiorCount source indices
    const bucketSpan = (n - 2) / interiorCount;
    let prevIdx = 0; // index of last selected point

    for (let i = 0; i < interiorCount; i++) {
        // Bucket range  [start, end)  — exclusive of the already-selected first point
        const start = Math.floor(1 + i * bucketSpan);
        const end = Math.floor(1 + (i + 1) * bucketSpan);

        // Average of the *next* bucket (used as the third triangle vertex)
        const nextStart = Math.floor(1 + (i + 1) * bucketSpan);
        const nextEnd = Math.floor(1 + (i + 2) * bucketSpan);
        const nextCount = Math.max(1, Math.min(nextEnd, n) - Math.min(nextStart, n));

        let avgX = 0;
        let avgY = 0;
        for (let j = nextStart; j < nextEnd && j < n; j++) {
            avgX += j;
            avgY += data[j];
        }
        avgX /= nextCount;
        avgY /= nextCount;

        // Pick the point in [start, end) forming the largest triangle
        // with (prevIdx, data[prevIdx]) and (avgX, avgY).
        const limit = Math.min(end, n);
        let bestIdx = Math.min(start, n - 1);
        let maxArea = -1;

        for (let j = start; j < limit; j++) {
            // Area = 0.5 * |(x_B - x_A)(y_C - y_A) - (x_C - x_A)(y_B - y_A)|
            // We skip the 0.5 factor (irrelevant for comparison).
            const area = Math.abs(
                (j - prevIdx) * (avgY - data[prevIdx]) -
                (avgX - prevIdx) * (data[j] - data[prevIdx]),
            );
            if (area > maxArea) {
                maxArea = area;
                bestIdx = j;
            }
        }

        result.push(data[bestIdx]);
        prevIdx = bestIdx;
    }

    result.push(data[n - 1]);
    return result;
}
