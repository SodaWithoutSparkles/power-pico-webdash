// Time-windowed averaging for live panel values.
// Keeps a ring of (timestamp, v, i, w) samples, drops entries older than the window.

export const SMOOTH_MODES = ["XFast", "Fast", "Medium", "Slow", "XSlow"] as const;
export type SmoothMode = (typeof SMOOTH_MODES)[number];

export const SMOOTH_WINDOW_MS: Record<SmoothMode, number> = {
    XFast: 0,
    Fast: 50,
    Medium: 200,
    Slow: 500,
    XSlow: 1000,
};

const HARD_CAP_MS = 1000; // hard cap on how many samples to keep

export interface SmoothedValues {
    v: number;
    i: number;
    w: number;
}

export class LiveSmoother {
    private samples: { t: number; v: number; i: number; w: number }[] = [];
    private _mode: SmoothMode = "XFast";

    get mode(): SmoothMode { return this._mode; }
    set mode(m: SmoothMode) {
        if (m === this._mode) return;
        this._mode = m;
        this.samples = [];
    }

    /** Push a fresh reading. Call once per render frame. */
    push(v: number, i: number, w: number, now: number): void {
        const modeMs = SMOOTH_WINDOW_MS[this._mode];
        this.samples.push({ t: now, v, i, w });

        if (modeMs > 0) {
            const cutoff = now - modeMs;
            // Trim old samples from front — O(n) but n ≤ ~30 at 60 fps / 500 ms
            while (this.samples.length > 0 && this.samples[0].t < cutoff) {
                this.samples.shift();
            }
        }

        // Hard cap: no reason to keep more than HARD_CAP_MS worth of samples, even if the mode is XFast
        if (this.samples.length > 0 && now - this.samples[0].t > HARD_CAP_MS) {
            const cutoff = now - HARD_CAP_MS;
            while (this.samples.length > 0 && this.samples[0].t < cutoff) {
                this.samples.shift();
            }
        }
    }

    /** Compute the time-windowed average. For XFast (window=0) returns the latest value. */
    getSmoothed(): SmoothedValues {
        if (this.samples.length === 0) return { v: 0, i: 0, w: 0 };

        if (SMOOTH_WINDOW_MS[this._mode] === 0) {
            const last = this.samples[this.samples.length - 1];
            return { v: last.v, i: last.i, w: last.w };
        }

        // Average all samples — push() already keeps only the time window
        let sumV = 0, sumI = 0, sumW = 0;
        const count = this.samples.length;
        for (const s of this.samples) {
            sumV += s.v;
            sumI += s.i;
            sumW += s.w;
        }
        return { v: sumV / count, i: sumI / count, w: sumW / count };
    }

    reset(): void {
        this.samples = [];
    }
}
