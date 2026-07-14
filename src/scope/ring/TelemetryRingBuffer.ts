// SoA ring buffer for telemetry data.
// Uses typed arrays for cache-friendly storage and easy transferable postMessage.

export interface RingBufferOptions {
    /**
     * Granular control over which extremes are tracked inside the buffer.
     *
     * Each field can be omitted entirely (defaults below), or set to `{}` to
     * disable all extremes for that channel.  Individual flags default to true
     * when the parent object is present but the sub-field is omitted.
     *
     * Default for the main raw ring:
     *   `{ current: { peak: true, min: true, max: true } }`
     *
     * Default for all other rings (display, temp):
     *   no extremes (pass `{}` or omit).
     */
    trackExtremes?: {
        current?: { peak?: boolean; min?: boolean; max?: boolean };
        voltage?: { min?: boolean; max?: boolean };
    };
}

export class TelemetryRingBuffer {
    readonly timestamps: BigInt64Array;
    readonly voltages: Float32Array;
    readonly currents: Float32Array;
    readonly capacity: number;
    private head = 0;
    private count = 0;

    // ── Cached extremes (lazy rescan on eviction) ──
    // Each _*Idx field is -1 when stale (or tracking is disabled).
    private _trackPeakI: boolean;
    private _trackMinI: boolean;
    private _trackMaxI: boolean;
    private _trackMinV: boolean;
    private _trackMaxV: boolean;

    // Peak |current|
    private _peakIdx = -1;
    private _peakAbsCurrent = 0;

    // Min/max current
    private _minIIdx = -1;
    private _minICurrent = 0;
    private _maxIIdx = -1;
    private _maxICurrent = 0;

    // Min/max voltage
    private _minVIdx = -1;
    private _minVVoltage = 0;
    private _maxVIdx = -1;
    private _maxVVoltage = 0;

    constructor(capacity = 1_000_000, options?: RingBufferOptions) {
        this.capacity = capacity;
        this.timestamps = new BigInt64Array(capacity);
        this.voltages = new Float32Array(capacity);
        this.currents = new Float32Array(capacity);

        const ci = options?.trackExtremes?.current;
        const v = options?.trackExtremes?.voltage;
        this._trackPeakI = ci?.peak ?? false;
        this._trackMinI = ci?.min ?? false;
        this._trackMaxI = ci?.max ?? false;
        this._trackMinV = v?.min ?? false;
        this._trackMaxV = v?.max ?? false;
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
    /** Index of the most recent element (logical end). */
    get lastIdx(): number {
        if (this.count === 0) return -1;
        return this.head === 0 ? this.capacity - 1 : this.head - 1;
    }
    get isFull(): boolean {
        return this.count === this.capacity;
    }


    /** Push one sample. O(1). Tracks only the extremes enabled via options. */
    push(ts: bigint, v: number, i: number): void {
        const isEvicting = this.count === this.capacity;

        // Mark cached extremes stale when their slot is overwritten.
        if (isEvicting) {
            if (this.head === this._peakIdx) this._peakIdx = -1;
            if (this.head === this._minIIdx) this._minIIdx = -1;
            if (this.head === this._maxIIdx) this._maxIIdx = -1;
            if (this.head === this._minVIdx) this._minVIdx = -1;
            if (this.head === this._maxVIdx) this._maxVIdx = -1;
        }

        this.timestamps[this.head] = ts;
        this.voltages[this.head] = v;
        this.currents[this.head] = i;

        // ── Peak |current| ──
        if (this._trackPeakI) {
            const absI = Math.abs(i);
            if (this._peakIdx < 0 || absI > this._peakAbsCurrent) {
                this._peakIdx = this.head;
                this._peakAbsCurrent = absI;
            }
        }

        // ── Min current ──
        if (this._trackMinI && (this._minIIdx < 0 || i < this._minICurrent)) {
            this._minIIdx = this.head;
            this._minICurrent = i;
        }

        // ── Max current ──
        if (this._trackMaxI && (this._maxIIdx < 0 || i > this._maxICurrent)) {
            this._maxIIdx = this.head;
            this._maxICurrent = i;
        }

        // ── Min voltage ──
        if (this._trackMinV && (this._minVIdx < 0 || v < this._minVVoltage)) {
            this._minVIdx = this.head;
            this._minVVoltage = v;
        }

        // ── Max voltage ──
        if (this._trackMaxV && (this._maxVIdx < 0 || v > this._maxVVoltage)) {
            this._maxVIdx = this.head;
            this._maxVVoltage = v;
        }

        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
    }

    /**
     * Peak absolute current across the ring buffer.
     * Returns cached value if valid, otherwise rescans lazily.
     * Returns 0 when tracking is disabled.
     */
    get peakCurrent(): number {
        if (!this._trackPeakI) return 0;
        if (this._peakIdx >= 0) return this._peakAbsCurrent;
        const len = this.count;
        if (len === 0) return 0;
        const tail = this.tailIdx;
        const cap = this.capacity;
        let peak = 0;
        let peakIdx = -1;
        for (let i = 0; i < len; i++) {
            const idx = (tail + i) % cap;
            const a = Math.abs(this.currents[idx]);
            if (a > peak) { peak = a; peakIdx = idx; }
        }
        this._peakIdx = peakIdx;
        this._peakAbsCurrent = peak;
        return peak;
    }

    /** Minimum current in the buffer (cached, lazy rescan). Returns 0 when disabled/empty. */
    get minCurrent(): number {
        if (!this._trackMinI) return 0;
        if (this._minIIdx >= 0) return this._minICurrent;
        this._rescanCurrent();
        return this._minICurrent;
    }

    /** Maximum current in the buffer (cached, lazy rescan). Returns 0 when disabled/empty. */
    get maxCurrent(): number {
        if (!this._trackMaxI) return 0;
        if (this._maxIIdx >= 0) return this._maxICurrent;
        this._rescanCurrent();
        return this._maxICurrent;
    }

    /** Minimum voltage in the buffer (cached, lazy rescan). Returns 0 when disabled/empty. */
    get minVoltage(): number {
        if (!this._trackMinV) return 0;
        if (this._minVIdx >= 0) return this._minVVoltage;
        this._rescanVoltage();
        return this._minVVoltage;
    }

    /** Maximum voltage in the buffer (cached, lazy rescan). Returns 0 when disabled/empty. */
    get maxVoltage(): number {
        if (!this._trackMaxV) return 0;
        if (this._maxVIdx >= 0) return this._maxVVoltage;
        this._rescanVoltage();
        return this._maxVVoltage;
    }

    /** Returns all tracked extremes in one call (triggers at most one rescan per channel). */
    getExtremes(): { minV: number; maxV: number; minI: number; maxI: number; peakI: number } {
        return {
            peakI: this.peakCurrent,
            minI: this.minCurrent,
            maxI: this.maxCurrent,
            minV: this.minVoltage,
            maxV: this.maxVoltage,
        };
    }

    /** Rescan the entire ring for current min/max. */
    private _rescanCurrent(): void {
        const len = this.count;
        if (len === 0) {
            this._minIIdx = -1; this._minICurrent = 0;
            this._maxIIdx = -1; this._maxICurrent = 0;
            return;
        }
        const tail = this.tailIdx;
        const cap = this.capacity;
        let minCur = this.currents[tail];
        let maxCur = this.currents[tail];
        let minIdx = tail;
        let maxIdx = tail;
        for (let i = 1; i < len; i++) {
            const idx = (tail + i) % cap;
            const c = this.currents[idx];
            if (this._trackMinI && c < minCur) { minCur = c; minIdx = idx; }
            if (this._trackMaxI && c > maxCur) { maxCur = c; maxIdx = idx; }
        }
        this._minIIdx = this._trackMinI ? minIdx : -1;
        this._minICurrent = minCur;
        this._maxIIdx = this._trackMaxI ? maxIdx : -1;
        this._maxICurrent = maxCur;
    }

    /** Rescan the entire ring for voltage min/max. */
    private _rescanVoltage(): void {
        const len = this.count;
        if (len === 0) {
            this._minVIdx = -1; this._minVVoltage = 0;
            this._maxVIdx = -1; this._maxVVoltage = 0;
            return;
        }
        const tail = this.tailIdx;
        const cap = this.capacity;
        let minV = this.voltages[tail];
        let maxV = this.voltages[tail];
        let minIdx = tail;
        let maxIdx = tail;
        for (let i = 1; i < len; i++) {
            const idx = (tail + i) % cap;
            const v = this.voltages[idx];
            if (this._trackMinV && v < minV) { minV = v; minIdx = idx; }
            if (this._trackMaxV && v > maxV) { maxV = v; maxIdx = idx; }
        }
        this._minVIdx = this._trackMinV ? minIdx : -1;
        this._minVVoltage = minV;
        this._maxVIdx = this._trackMaxV ? maxIdx : -1;
        this._maxVVoltage = maxV;
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
     * Return a contiguous copy of the last `count` samples in chronological order.
     * If count > length, returns all samples.
     */
    sliceLast(count: number): { timestamps: BigInt64Array; voltages: Float32Array; currents: Float32Array } {
        if (count <= 0) return { timestamps: new BigInt64Array(0), voltages: new Float32Array(0), currents: new Float32Array(0) };
        if (count > this.count) count = this.count;
        const startIdx = (this.head - count + this.capacity) % this.capacity;
        return this.slice(startIdx, this.head);
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
        this._peakIdx = -1;
        this._peakAbsCurrent = 0;
        this._minIIdx = -1;
        this._minICurrent = 0;
        this._maxIIdx = -1;
        this._maxICurrent = 0;
        this._minVIdx = -1;
        this._minVVoltage = 0;
        this._maxVIdx = -1;
        this._maxVVoltage = 0;
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
