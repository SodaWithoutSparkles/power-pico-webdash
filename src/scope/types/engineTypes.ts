// Shared types for the scope engine (Phase 2). DOM-free, no deps.

export interface ScopeChannels {
    v: boolean;
    i: boolean;
    w: boolean;
}

export interface ScopeConfig {
    baudRate: number;
    ringCapacity: number; // raw ring buffer capacity (applies after reconnect)
    avgSize: number; // k: observations per display bucket
    windowSize: number; // N: display ring capacity
    avgMode: "simple" | "lttb";
    channels: ScopeChannels;
    nominalSampleRate: number; // user-expected samples/s, used for time-based UX
    expectedSamplesPerPacket: number; // expected raw samples per device packet
    packetSmoothing: number; // -1=smooth whole packet, else group size (must divide expectedSamplesPerPacket)
}

export type ScopeMode = "idle" | "serial" | "simulate";

export interface ScopeStatus {
    running: boolean;
    mode: ScopeMode;
    samplesPerSec: number;
    observationCount: number;
    bufferFillPct: number;
    lastTimestampUs: number; // raw device timestamp of latest packet
    liveV: number;
    liveI: number;
    liveW: number;
    packetWarning: string | null;
}

