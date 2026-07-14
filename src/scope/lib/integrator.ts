// Integration math for energy (J) and charge (C).
// Dual-stage accumulation to avoid precision loss with many small steps.

import { TelemetryRingBuffer } from "../ring/TelemetryRingBuffer";

/**
 * Dual-stage integrator that accumulates charge (Coulombs) and energy (Joules).
 * Uses micro-accumulators flushed to global totals to avoid float drift.
 */
export class DualStageIntegrator {
    /** Fractional Coulomb accumulator. */
    microQ = 0;
    /** Fractional Joule accumulator. */
    microE = 0;
    /** Floated global Coulomb total. */
    totalQ = 0;
    /** Floated global Joule total. */
    totalE = 0;
    /** Previous timestamp for Δt computation. */
    lastTs: bigint | null = null;

    /** Push one sample. */
    push(ts: bigint, v: number, i: number): void {
        if (this.lastTs === null) {
            this.lastTs = ts;
            return;
        }

        const dt = Number(ts - this.lastTs) / 1e9; // μs → seconds
        const dQ = i * dt;
        const dE = v * i * dt;

        this.microQ += dQ;
        this.microE += dE;

        if (this.microQ >= 1.0) {
            this.totalQ += Math.floor(this.microQ);
            this.microQ -= Math.floor(this.microQ);
        }
        if (this.microE >= 1.0) {
            this.totalE += Math.floor(this.microE);
            this.microE -= Math.floor(this.microE);
        }

        this.lastTs = ts;
    }

    /** Reset all accumulators. */
    reset(): void {
        this.microQ = 0;
        this.microE = 0;
        this.totalQ = 0;
        this.totalE = 0;
        this.lastTs = null;
    }

    /** Get current totals (includes fractional part). */
    getTotals(): { chargeC: number; energyJ: number } {
        return {
            chargeC: this.totalQ + this.microQ,
            energyJ: this.totalE + this.microE,
        };
    }
}

/**
 * Integrate a range of the ring buffer [startTs, endTs) in a single pass.
 * Returns energy (J), charge (C), and duration (μs) over that window.
 */
export function integrateRange(
    ring: TelemetryRingBuffer,
    startTs: bigint,
    endTs: bigint,
): { energyJ: number; chargeC: number; dtUs: number } {
    const startIdx = ring.binarySearch(startTs);
    if (startIdx < 0) return { energyJ: 0, chargeC: 0, dtUs: 0 };

    let endIdx = ring.binarySearch(endTs);
    if (endIdx < 0) endIdx = ring.length;

    if (endIdx <= startIdx) return { energyJ: 0, chargeC: 0, dtUs: 0 };

    let energyJ = 0;
    let chargeC = 0;
    let prevTs: bigint | null = null;

    const cap = ring.capacity;
    let idx = startIdx;
    const limit = _rangeLen(startIdx, endIdx, cap, ring.length);

    for (let i = 0; i < limit; i++) {
        const ts = ring.timestamps[idx];
        const v = ring.voltages[idx];
        const c = ring.currents[idx];

        if (prevTs !== null) {
            const dt = Number(ts - prevTs) / 1e9;
            chargeC += c * dt;
            energyJ += v * c * dt;
        }
        prevTs = ts;
        idx = (idx + 1) % cap;
    }

    const dtUs = prevTs !== null ? Number(prevTs - ring.timestamps[startIdx]) : 0;

    return { energyJ, chargeC, dtUs };
}

function _rangeLen(startIdx: number, endIdx: number, capacity: number, count: number): number {
    if (count === 0) return 0;
    if (startIdx <= endIdx) return endIdx - startIdx;
    return capacity - startIdx + endIdx;
}
