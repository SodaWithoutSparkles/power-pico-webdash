// Shared types for the scope engine (Phase 2). DOM-free, no deps.

import type { DecodedPacket } from "./decode";

export interface ScopeChannels {
    v: boolean;
    i: boolean;
    w: boolean;
}

export interface ScopeConfig {
    baudRate: number;
    avgSize: number; // k: packets in the averaging window
    windowSize: number; // N: display ring capacity
    channels: ScopeChannels;
}

export type ScopeMode = "idle" | "serial" | "simulate";

export interface ScopeStatus {
    running: boolean;
    mode: ScopeMode;
    pktPerSec: number;
    sampleCount: number;
    bufferFillPct: number;
    lastTimestampUs: number; // raw device timestamp of latest packet
    liveV: number;
    liveI: number;
    liveW: number;
}

// ── Scale / hysteresis ──

export type ScaleTier = "ua" | "ma" | "a";

export interface HysteresisState {
    tier: ScaleTier;
    /** Accumulated time (ms) below the down-threshold. */
    downTimer: number;
}

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

// ── Temporary compat aliases (will be removed in Phase E cleanup) ──

/** @deprecated Use BucketedTelemetryData instead. */
export interface DisplayPoint {
    t: number;
    v: number;
    i: number;
    w: number;
}

/** @deprecated Use BucketedTelemetryData instead. */
export interface DisplaySnapshot {
    t: Float64Array;
    v: Float64Array;
    i: Float64Array;
    w: Float64Array;
}

/** @deprecated Use worker postMessage instead. */
export type StatusCallback = (status: ScopeStatus) => void;
/** @deprecated Use worker postMessage instead. */
export type ErrorCallback = (error: Error) => void;

export type { DecodedPacket };
