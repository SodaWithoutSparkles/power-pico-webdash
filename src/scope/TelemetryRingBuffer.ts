// SoA ring buffer for telemetry data.
// Uses typed arrays for cache-friendly storage and easy transferable postMessage.

export class TelemetryRingBuffer {
    readonly timestamps: BigInt64Array;
    readonly voltages: Float32Array;
    readonly currents: Float32Array;
    readonly capacity: number;
    private head = 0;
    private count = 0;

    constructor(capacity = 1_000_000) {
        this.capacity = capacity;
        this.timestamps = new BigInt64Array(capacity);
        this.voltages = new Float32Array(capacity);
        this.currents = new Float32Array(capacity);
    }

    /** Number of elements currently stored. */
    get length(): number {
        return this.count;
    }

    /** Fill percentage (0–1). */
    get fillPct(): number {
        return Math.min(1, this.count / this.capacity);
    }

    /** Current write index. */
    get headIdx(): number {
        return this.head;
    }

    /** Index of the oldest element (logical start). */
    get tailIdx(): number {
        if (this.count < this.capacity) return 0;
        return this.head; // head points at oldest when full
    }

    /** Push one sample. O(1). */
    push(ts: bigint, v: number, i: number): void {
        this.timestamps[this.head] = ts;
        this.voltages[this.head] = v;
        this.currents[this.head] = i;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
    }

    /**
     * Binary search for the first index whose timestamp >= ts.
     * Operates on the logical chronological segment of the ring.
     * Returns -1 if all timestamps are < ts.
     */
    binarySearch(ts: bigint): number {
        if (this.count === 0) return -1;
        const len = this.count;
        const tail = this.tailIdx;

        // If not wrapped, do a direct binary search on [tail, tail+len).
        if (!this.wrapped) {
            const arr = this.timestamps;
            let lo = 0;
            let hi = len;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (arr[tail + mid] < ts) lo = mid + 1;
                else hi = mid;
            }
            return lo < len ? tail + lo : -1;
        }

        // Wrapped: logical order is [tail .. capacity-1] then [0 .. head-1].
        // Search the first segment, then the second.
        const firstLen = this.capacity - tail;
        // Search first segment
        let lo = 0;
        let hi = firstLen;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.timestamps[tail + mid] < ts) lo = mid + 1;
            else hi = mid;
        }
        if (lo < firstLen) return tail + lo;

        // Search second segment [0, head)
        const secondLen = this.head;
        lo = 0;
        hi = secondLen;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.timestamps[mid] < ts) lo = mid + 1;
            else hi = mid;
        }
        return lo < secondLen ? lo : -1;
    }

    /**
     * Return a contiguous copy of the range [startIdx, endIdx).
     * startIdx and endIdx are absolute ring indices (0..capacity-1).
     * Handles wrap.
     */
    slice(startIdx: number, endIdx: number): { timestamps: BigInt64Array; voltages: Float32Array; currents: Float32Array } {
        const len = this.logicalCount(startIdx, endIdx);
        const ts = new BigInt64Array(len);
        const vs = new Float32Array(len);
        const cs = new Float32Array(len);

        this._copyRange(startIdx, endIdx, ts, vs, cs);
        return { timestamps: ts, voltages: vs, currents: cs };
    }

    /**
     * Number of elements in the logical range [startIdx, endIdx), handling wrap.
     * Both indices are absolute ring positions (0..capacity-1).
     */
    logicalCount(startIdx: number, endIdx: number): number {
        if (this.count === 0) return 0;
        if (startIdx <= endIdx) return endIdx - startIdx;
        return this.capacity - startIdx + endIdx;
    }

    /** Clear all data. */
    clear(): void {
        this.head = 0;
        this.count = 0;
    }

    // ── Internal helpers ──

    private get wrapped(): boolean {
        return this.count === this.capacity;
    }

    /** Copy range [start, end) into the provided output arrays. */
    private _copyRange(
        start: number,
        end: number,
        tsOut: BigInt64Array,
        vsOut: Float32Array,
        csOut: Float32Array,
    ): void {
        if (start <= end) {
            tsOut.set(this.timestamps.subarray(start, end));
            vsOut.set(this.voltages.subarray(start, end));
            csOut.set(this.currents.subarray(start, end));
        } else {
            const firstLen = this.capacity - start;
            tsOut.set(this.timestamps.subarray(start));
            vsOut.set(this.voltages.subarray(start));
            csOut.set(this.currents.subarray(start));
            if (end > 0) {
                tsOut.set(this.timestamps.subarray(0, end), firstLen);
                vsOut.set(this.voltages.subarray(0, end), firstLen);
                csOut.set(this.currents.subarray(0, end), firstLen);
            }
        }
    }
}
