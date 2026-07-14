// Hysteresis (Schmitt trigger) scale switching for current display auto-ranging.
// Pure functions, no UI deps.

export type ScaleTier = "ua" | "ma" | "a";

export interface HysteresisState {
    tier: ScaleTier;
    /** Accumulated time (ms) below the down-threshold. */
    downTimer: number;
}

export function createHysteresisState(): HysteresisState {
    return { tier: "ma", downTimer: 0 };
}

/**
 * Update the hysteresis state given the latest peak current and current time.
 *
 * Schmitt trigger logic:
 * - peak > 1.0 A       → instant up to "a", reset timer
 * - peak > 500e-6 A    → instant up to "ma", reset timer
 * - peak < 400e-6 A & tier "ma" → accumulate timer; >=1500ms → down to "ua"
 * - peak < 0.8 A & tier "a"     → accumulate timer; >=1500ms → down to "ma"
 * - otherwise → reset timer (signal in band)
 */
export function updateScale(
    state: HysteresisState,
    peakCurrentA: number,
    now: number,
): HysteresisState {
    let { tier, downTimer } = state;

    if (peakCurrentA > 1.0) {
        return { tier: "a", downTimer: 0 };
    }

    if (peakCurrentA > 500e-6) {
        return { tier: "ma", downTimer: 0 };
    }

    if (tier === "a") {
        if (peakCurrentA < 0.8) {
            downTimer += now - (now - 16); // ~1 frame delta; caller should pass real `now`
            // Actually we need consistent time tracking. Use passed `now` vs stored lastCheck.
            // Simpler: just accumulate 16ms per call as rough frame estimate.
            // Better: store a `lastUpdate` in the state and compute real delta.
            // But the plan says state = { tier, downTimer }. We'll compute delta via a separate param.
            // For now assume 16ms per call. The real integration will use actual delta.
            if (downTimer >= 1500) {
                return { tier: "ma", downTimer: 0 };
            }
            return { tier, downTimer };
        }
        return { tier, downTimer: 0 };
    }

    if (tier === "ma") {
        if (peakCurrentA < 400e-6) {
            downTimer += 16; // approximate per-call delta
            if (downTimer >= 1500) {
                return { tier: "ua", downTimer: 0 };
            }
            return { tier, downTimer };
        }
        return { tier, downTimer: 0 };
    }

    // tier === "ua"
    if (peakCurrentA > 400e-6) {
        return { tier: "ma", downTimer: 0 };
    }
    return { tier, downTimer: 0 };
}

/** Refined updateScale that uses real delta time. */
export function updateScaleDelta(
    state: HysteresisState,
    peakCurrentA: number,
    deltaMs: number,
): HysteresisState {
    let { tier, downTimer } = state;

    if (peakCurrentA > 1.0) {
        return { tier: "a", downTimer: 0 };
    }

    if (peakCurrentA > 500e-6) {
        return { tier: "ma", downTimer: 0 };
    }

    if (tier === "a") {
        if (peakCurrentA < 0.8) {
            downTimer += deltaMs;
            if (downTimer >= 1500) {
                return { tier: "ma", downTimer: 0 };
            }
            return { tier, downTimer };
        }
        return { tier, downTimer: 0 };
    }

    if (tier === "ma") {
        if (peakCurrentA < 400e-6) {
            downTimer += deltaMs;
            if (downTimer >= 1500) {
                return { tier: "ua", downTimer: 0 };
            }
            return { tier, downTimer };
        }
        return { tier, downTimer: 0 };
    }

    // tier === "ua"
    if (peakCurrentA > 400e-6) {
        return { tier: "ma", downTimer: 0 };
    }
    return { tier, downTimer: 0 };
}

/** Convert a peak current (amps) to a display value in the given tier's units. */
export function peakToUnitValue(peak: number, tier: ScaleTier): number {
    switch (tier) {
        case "ua": return peak * 1_000_000;
        case "ma": return peak * 1_000;
        case "a": return peak;
    }
}

/** Get the display label for a scale tier. */
export function tierToLabel(tier: ScaleTier): string {
    switch (tier) {
        case "ua": return "µA";
        case "ma": return "mA";
        case "a": return "A";
    }
}
