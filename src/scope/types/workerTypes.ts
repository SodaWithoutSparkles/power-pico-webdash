// Types for the scope engine data pipeline.
// DOM-free, no deps.

// ── Bucketed telemetry (format-engine output) ──

export interface BucketedTelemetryData {
    /** Midpoint timestamps for each bucket, as float μs (T+0 applied). */
    timestamps: Float64Array;
    /** Average voltage per bucket. */
    avgV: Float32Array;
    /** Minimum voltage per bucket. */
    minV: Float32Array;
    /** Maximum voltage per bucket. */
    maxV: Float32Array;
    /** Average current per bucket. */
    avgI: Float32Array;
    /** Minimum current per bucket. */
    minI: Float32Array;
    /** Maximum current per bucket. */
    maxI: Float32Array;
}

// ── Engine status (computed by ScopeEngine.computeStatus) ──

export interface StatusPayload {
    running: boolean;
    mode: "idle" | "serial" | "simulate";
    samplesPerSec: number;
    observationCount: number;
    bufferFillPct: number;
    liveV: number;
    liveI: number;
    liveW: number;
    lastTimestampUs: number;
    packetWarning: string | null;
}


