// Preallocated ring buffer of display points. Overwrites the oldest entry when
// full (scrolling trace). snapshot() returns channels in chronological order
// for direct hand-off to uPlot.

import type { DisplayPoint, DisplaySnapshot } from "./engineTypes";

export class DisplayRingBuffer {
    private t: Float64Array;
    private v: Float64Array;
    private i: Float64Array;
    private w: Float64Array;
    private range: Float64Array;
    private head = 0; // next write slot
    private count = 0;

    constructor(capacity: number) {
        this.capacity = capacity;
        this.t = new Float64Array(capacity);
        this.v = new Float64Array(capacity);
        this.i = new Float64Array(capacity);
        this.w = new Float64Array(capacity);
        this.range = new Float64Array(capacity);
    }

    capacity: number;

    push(p: DisplayPoint): void {
        this.t[this.head] = p.t;
        this.v[this.head] = p.v;
        this.i[this.head] = p.i;
        this.w[this.head] = p.w;
        this.range[this.head] = p.range;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
    }

    get length(): number {
        return this.count;
    }

    get fillPct(): number {
        return this.capacity === 0 ? 0 : this.count / this.capacity;
    }

    snapshot(): DisplaySnapshot {
        const t = new Float64Array(this.count);
        const v = new Float64Array(this.count);
        const i = new Float64Array(this.count);
        const w = new Float64Array(this.count);
        const range = new Float64Array(this.count);
        const start = (this.head - this.count + this.capacity) % this.capacity;
        for (let k = 0; k < this.count; k++) {
            const idx = (start + k) % this.capacity;
            t[k] = this.t[idx];
            v[k] = this.v[idx];
            i[k] = this.i[idx];
            w[k] = this.w[idx];
            range[k] = this.range[idx];
        }
        return { t, v, i, w, range };
    }

    clear(): void {
        this.head = 0;
        this.count = 0;
    }

    // Reallocate, preserving the most recent `min(old, capacity)` points.
    resize(capacity: number): void {
        if (capacity === this.capacity) return;
        const snap = this.snapshot();
        this.capacity = capacity;
        this.t = new Float64Array(capacity);
        this.v = new Float64Array(capacity);
        this.i = new Float64Array(capacity);
        this.w = new Float64Array(capacity);
        this.range = new Float64Array(capacity);
        this.head = 0;
        this.count = 0;
        const keep = Math.min(snap.t.length, capacity);
        const start = snap.t.length - keep; // keep the most recent points
        for (let k = 0; k < keep; k++) {
            this.push({ t: snap.t[start + k], v: snap.v[start + k], i: snap.i[start + k], w: snap.w[start + k], range: snap.range[start + k] });
        }
    }
}
