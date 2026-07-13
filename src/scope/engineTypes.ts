// Shared types for the scope engine (Phase 2). DOM-free, no deps.

import type { DecodedPacket } from "./decode";

export interface ScopeChannels {
    v: boolean;
    i: boolean;
    w: boolean;
}

export type UnitMode = 'off' | 'si' | 'meter';
export type VoltageUnit = 'uV' | 'mV' | 'V';
export type CurrentUnit = 'uA' | 'mA' | 'A';
export type PowerUnit = 'uW' | 'mW' | 'W';

export interface YScale {
    auto: boolean;
    min: number;
    max: number;
}

export interface ScopeConfig {
    baudRate: number;
    avgSize: number; // k: packets in the averaging window
    channels: ScopeChannels;
    hZoomSec: number; // visible time window (seconds); 0 = fit all buffer
    followLatest: boolean; // pin x-axis to the latest sample (scroll) vs free-pan
    // ADD:
    pktPerSec: number;        // nominal packet rate, default 1000
    bufferSec: number;        // ring buffer duration in seconds, default 5
    vZeroOffsetV: number;     // software zero offset (volts), default 0
    iZeroOffsetA: number;     // software zero offset (amps), default 0
    energyCamp: 'joules' | 'watt-hours';  // energy display unit, default 'joules'
    // Phase 2: unit auto-range + per-series Y scales + calibration
    vUnitMode: UnitMode;      // voltage unit mode, default 'si'
    iUnitMode: UnitMode;      // current unit mode, default 'si'
    vFixedUnit: VoltageUnit;  // used when vUnitMode='off', default 'V'
    iFixedUnit: CurrentUnit;  // used when iUnitMode='off', default 'A'
    vYScale: YScale;          // voltage Y-axis scale, default { auto: true, min: 0, max: 0 }
    iYScale: YScale;          // current Y-axis scale, default { auto: true, min: 0, max: 0 }
    wYScale: YScale;          // power Y-axis scale, default { auto: true, min: 0, max: 0 }
    calibrationTimeSec: number; // calibration sampling duration, default 5
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
    sessionEnergyJ: number; // accumulated since last reset
    sessionChargeC: number; // accumulated since last reset
    tZeroOffsetUs: number; // current T+0 offset (mirrored for UI)
}

// One averaged sample pushed to the display ring.
export interface DisplayPoint {
    t: number; // display x (us), already T+0 offset
    v: number;
    i: number;
    w: number;
    range: number;  // LOW=1, MID=2, HIGH=3; 0 = no range / voltage
}

export interface DisplaySnapshot {
    t: Float64Array;
    v: Float64Array;
    i: Float64Array;
    w: Float64Array;
    range: Float64Array;
}

export type StatusCallback = (status: ScopeStatus) => void;
export type ErrorCallback = (error: Error) => void;

// Statistics over a drag-selected time region.
export interface RegionStats {
    energyJ: number;
    chargeC: number;
    // Per-series stats (null if no finite samples in range)
    vAvg: number | null;
    vMin: number | null;
    vMax: number | null;
    iAvg: number | null;
    iMin: number | null;
    iMax: number | null;
    wAvg: number | null;
    wMin: number | null;
    wMax: number | null;
}

export type { DecodedPacket };

// --- Detector (threshold crossing + peak detection) -----------------------

// Detector direction
export type DetectorDirection = 'positive' | 'negative' | 'both';

// Per-channel detector config
export interface DetectorChannelConfig {
    enabled: boolean;
    threshold: number;       // crossing level in base units (V or A)
    hysteresis: number;      // must drop below (threshold - hysteresis) to re-arm
    debounceMs: number;      // minimum time between events
    direction: DetectorDirection;
}

// Both channels' detector config
export interface DetectorConfig {
    v: DetectorChannelConfig;
    i: DetectorChannelConfig;
}

// A detected event
export interface DetectorEvent {
    id: number;              // auto-incrementing
    channel: 'v' | 'i';
    timestampUs: number;     // display-time (T+0 adjusted)
    value: number;           // the value that triggered
    direction: 'rising' | 'falling';  // which direction crossed threshold
    threshold: number;       // the threshold at time of detection
}
