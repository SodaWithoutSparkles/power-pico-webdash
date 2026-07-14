// Worker message protocol types for the scope engine.
// DOM-free, no deps. Shared between main thread and worker.

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

// ── Worker Requests ──

export type WorkerRequest =
    | { type: "init"; config: { baudRate: number; capacity: number } }
    | { type: "start" }
    | { type: "pause" }
    | { type: "clear" }
    | { type: "connect-serial" }
    | { type: "disconnect" }
    | { type: "start-simulate" }
    | { type: "stop-simulate" }
    | { type: "get-data-since"; sinceTs: bigint; bucketCount: number }
    | { type: "get-data-window"; fromFraction: number; toFraction: number; bucketCount: number }
    | { type: "get-frac-by-ts"; targetTs: bigint }
    | { type: "set-t-zero"; rawTsUs: number }
    | { type: "reset-t-zero" }
    | { type: "get-integration"; startTs: bigint; endTs: bigint };

// ── Worker Responses ──

export interface StatusPayload {
    running: boolean;
    mode: "idle" | "serial" | "simulate";
    pktPerSec: number;
    sampleCount: number;
    bufferFillPct: number;
    liveV: number;
    liveI: number;
    liveW: number;
    lastTimestampUs: number;
}

export type WorkerResponse =
    | { type: "status"; payload: StatusPayload }
    | { type: "bucketed-data"; payload: BucketedTelemetryData }
    | { type: "window-data"; payload: BucketedTelemetryData }
    | { type: "frac"; payload: number }
    | { type: "integration-result"; payload: { energyJ: number; chargeC: number; dtUs: number } }
    | { type: "error"; message: string };
