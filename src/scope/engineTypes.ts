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

// One averaged sample pushed to the display ring.
export interface DisplayPoint {
    t: number; // display x (us), already T+0 offset
    v: number;
    i: number;
    w: number;
}

export interface DisplaySnapshot {
    t: Float64Array;
    v: Float64Array;
    i: Float64Array;
    w: Float64Array;
}

export type StatusCallback = (status: ScopeStatus) => void;
export type ErrorCallback = (error: Error) => void;

export type { DecodedPacket };
