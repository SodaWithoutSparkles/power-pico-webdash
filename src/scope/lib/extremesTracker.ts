// Session-level extremes tracker.
// Tracks all-time min/max for voltage and current across the entire session.
// Only resets on demand. API mirrors DualStageIntegrator.

export class ExtremesTracker {
    /** Minimum voltage seen since last reset. */
    minV = Infinity;
    /** Maximum voltage seen since last reset. */
    maxV = -Infinity;
    /** Minimum current seen since last reset. */
    minI = Infinity;
    /** Maximum current seen since last reset. */
    maxI = -Infinity;

    /** Push one sample, updating running extremes. */
    push(_ts: bigint, v: number, i: number): void {
        if (v < this.minV) this.minV = v;
        if (v > this.maxV) this.maxV = v;
        if (i < this.minI) this.minI = i;
        if (i > this.maxI) this.maxI = i;
    }

    /** Reset all extremes to their initial sentinel values. */
    reset(): void {
        this.minV = Infinity;
        this.maxV = -Infinity;
        this.minI = Infinity;
        this.maxI = -Infinity;
    }

    /**
     * Current extremes. Returns 0 for any channel that hasn't seen data yet.
     * Convenience: if minV === Infinity, no data has been pushed.
     */
    getExtremes(): { minV: number; maxV: number; minI: number; maxI: number; hasData: boolean } {
        const hasData = this.minV !== Infinity;
        return {
            minV: hasData ? this.minV : 0,
            maxV: hasData ? this.maxV : 0,
            minI: hasData ? this.minI : 0,
            maxI: hasData ? this.maxI : 0,
            hasData,
        };
    }
}
