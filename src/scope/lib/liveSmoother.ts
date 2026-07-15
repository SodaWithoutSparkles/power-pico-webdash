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
    /** Timestamp (performance.now()) of the last throttled output. */
    private _lastOutputTime = 0;
    /** Cached output value, returned between throttle ticks. */
    private _cached: SmoothedValues = { v: 0, i: 0, w: 0 };

    get mode(): SmoothMode { return this._mode; }
    set mode(m: SmoothMode) {
        if (m === this._mode) return;
        this._mode = m;
        this.samples = [];
        this._lastOutputTime = 0; // reset throttle so next call outputs immediately
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

    /**
     * Return the throttled smoothed value.
     *
     * For XFast (window=0 / no throttle) returns the latest raw sample every call.
     * For all other modes, averages samples in the time window AND throttles the
     * output to the configured rate (e.g. XSlow → 1 Hz).  Between throttle ticks
     * the last computed value is held (sample-and-hold).
     *
     * @param now  Optional `performance.now()` timestamp.  Omit to use internal clock.
     */
    getSmoothed(now: number = performance.now()): SmoothedValues {
        if (this.samples.length === 0) return { v: 0, i: 0, w: 0 };

        const modeMs = SMOOTH_WINDOW_MS[this._mode];

        // XFast — no averaging, no throttling, always return the latest sample
        if (modeMs === 0) {
            const last = this.samples[this.samples.length - 1];
            return { v: last.v, i: last.i, w: last.w };
        }

        // Throttle: only recompute the output when the throttle window expires
        if (this._lastOutputTime === 0 || now - this._lastOutputTime >= modeMs) {
            // Average all samples in the current window
            let sumV = 0, sumI = 0, sumW = 0;
            const count = this.samples.length;
            for (const s of this.samples) {
                sumV += s.v;
                sumI += s.i;
                sumW += s.w;
            }
            this._cached = { v: sumV / count, i: sumI / count, w: sumW / count };
            this._lastOutputTime = now;
        }

        return this._cached;
    }

    reset(): void {
        this.samples = [];
        this._lastOutputTime = 0;
        this._cached = { v: 0, i: 0, w: 0 };
    }
}
