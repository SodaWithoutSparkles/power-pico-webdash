// Smart SI-prefix formatting for physical values.
// Picks the right prefix (µ/m/k/M) so the displayed number stays readable.
// No UI deps.

import type { ScaleTier } from "../lib/hysteresis";
import { tierToLabel } from "../lib/hysteresis";

/**
 * Format a current value (amps) using the hysteresis tier.
 * This keeps side panels consistent with the chart's current axis.
 */
export function fmtCurrent(amps: number, tier: ScaleTier): string {
    const label = tierToLabel(tier);
    switch (tier) {
        case "ua":
            return (amps * 1_000_000).toFixed(3) + " " + label;
        case "ma":
            return (amps * 1_000).toFixed(3) + " " + label;
        case "a":
            return amps.toFixed(3) + " " + label;
    }
}

/**
 * Format a value with smart SI prefix selection.
 * Picks µ → m → ∅ → k → M so the numeric part is ~0.1–999.99.
 *
 * @param value    Raw value in base units (e.g. volts, watts, joules, coulombs)
 * @param unit     Base unit label ("V", "W", "J", "C", etc.)
 * @param decimals Number of decimal places in the scaled output. Default 3.
 */
export function fmtSI(value: number, unit: string, decimals = 3): string {
    if (value === 0) return "0 " + unit;

    const abs = Math.abs(value);
    let scaled: number;
    let prefix: string;

    if (abs >= 1_000_000) { scaled = value / 1_000_000; prefix = "M"; }
    else if (abs >= 1_000) { scaled = value / 1_000; prefix = "k"; }
    else if (abs >= 1) { scaled = value; prefix = ""; }
    else if (abs >= 1e-3) { scaled = value * 1_000; prefix = "m"; }
    else if (abs >= 1e-6) { scaled = value * 1_000_000; prefix = "µ"; }
    else { scaled = value * 1_000_000_000; prefix = "n"; }

    return scaled.toFixed(decimals) + " " + prefix + unit;
}

/**
 * Format a time interval (µs) with smart prefix selection.
 * Result ranges from ns → µs → ms → s.
 */
export function fmtTimeUS(us: number, decimals = 2): string {
    if (us === 0) return "0 s";
    const abs = Math.abs(us);
    let scaled: number;
    let prefix: string;

    if (abs >= 1_000_000) { scaled = us / 1_000_000; prefix = ""; }    // s
    else if (abs >= 1_000) { scaled = us / 1_000; prefix = "m"; }   // ms
    else if (abs >= 1) { scaled = us; prefix = "µ"; }   // µs
    else { scaled = us * 1_000; prefix = "n"; }   // ns

    return scaled.toFixed(decimals) + " " + prefix + "s";
}
