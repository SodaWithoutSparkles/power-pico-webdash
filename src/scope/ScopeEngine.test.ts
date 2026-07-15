import { test, expect } from 'bun:test';
import assert from "node:assert/strict";

import { ScopeEngine } from "./ingest/ScopeEngine.ts";
import { Simulator } from "./ingest/simulate.ts";
import { decodePacket, type DecodedPacket } from "./decode/decode.ts";


// ── ScopeEngine tests ──

let _testTs = 0;

function resetTs(): void { _testTs = 0; }

/** Push `count` samples with globally monotonic timestamps. Returns the injected timestamps. */
function injectObservations(e: ScopeEngine, count: number): number[] {
    const result: number[] = [];
    for (let k = 0; k < count; k++) {
        e.pushSample(_testTs, _testTs * 2, _testTs * 3);
        result.push(_testTs);
        _testTs++;
    }
    return result;
}

test("ScopeEngine: averaging produces display bucket after avgWindowSize samples", () => {
    const e = new ScopeEngine(1000, 10, 3); // avgWindowSize=3
    e.start();

    e.pushSample(0, 1, 0);
    e.pushSample(1, 2, 0);
    // temp ring has 2/3 — display ring still empty
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 0);

    e.pushSample(2, 3, 0); // temp ring hits 3 → flushes a bucket
    const w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 1);
    assert.equal(w.avgV[0], 2); // (1+2+3)/3
    assert.equal(w.maxV[0], 3);
    assert.equal(w.minV[0], 1);

    // Push 3 more → second bucket
    e.pushSample(3, 10, 0);
    e.pushSample(4, 20, 0);
    e.pushSample(5, 30, 0);
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 2);

    e.pause();
});

test("ScopeEngine: avgWindowSize=1 streams every sample directly", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(10, 5, 1);
    e.pushSample(20, 7, 2);

    const w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 2);
    assert.equal(w.avgV[0], 5);
    assert.equal(w.avgV[1], 7);
    assert.equal(w.avgI[0], 1);
    assert.equal(w.avgI[1], 2);

    e.pause();
});

test("ScopeEngine: T+0 offset shifts display timestamps", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.setTZero(1000);
    e.start();

    e.pushSample(1000, 5, 0);
    const w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps[0], 0); // 1000 - 1000 = 0

    e.pause();
});

test("ScopeEngine: clear empties display rings", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(0, 1, 0);
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 1);

    e.clear();
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 0);

    e.pause();
});

test("ScopeEngine: followIngest=true always returns latest window", () => {
    resetTs();
    const e = new ScopeEngine(1000, 10, 1);
    e.start();
    e.followIngest = true;

    injectObservations(e, 5);
    let w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 5);
    assert.equal(w.timestamps[w.timestamps.length - 1], 4);

    injectObservations(e, 1);
    w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 6);
    assert.equal(w.timestamps[w.timestamps.length - 1], 5);

    injectObservations(e, 4);
    w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 10);
    assert.equal(w.timestamps[w.timestamps.length - 1], 9);

    e.pause();
});

test("ScopeEngine: display ring always returns latest buckets (frame buffer)", () => {
    resetTs();
    const e = new ScopeEngine(1000, 20, 1);
    e.start();

    injectObservations(e, 10);
    let w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 10);
    assert.deepEqual(Array.from(w.timestamps), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    injectObservations(e, 5);
    w = e.getLatestWindow(10, false);
    assert.deepEqual(Array.from(w.timestamps), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    e.pause();
});

test("ScopeEngine: display ring wraps and shows latest after wrap", () => {
    resetTs();
    const e = new ScopeEngine(30, 10, 1);
    e.start();

    injectObservations(e, 15);
    let w = e.getLatestWindow(10, false);
    assert.equal(w.timestamps.length, 10);
    assert.deepEqual(Array.from(w.timestamps), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    injectObservations(e, 5);
    w = e.getLatestWindow(10, false);
    assert.deepEqual(Array.from(w.timestamps), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    e.pause();
});


test("ScopeEngine: setDisplayWindow reconfigures display rings", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(0, 1, 0);
    e.pushSample(1, 2, 0);
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 2);

    e.setDisplayWindow(3, 1);
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 2, "replayed from raw ring");

    e.pushSample(2, 3, 0);
    e.pushSample(3, 4, 0);
    e.pushSample(4, 5, 0);
    e.pushSample(5, 6, 0);
    assert.equal(e.getLatestWindow(10, false).timestamps.length, 3);
    assert.deepEqual(Array.from(e.getLatestWindow(10, false).timestamps), [3, 4, 5]);

    e.pause();
});


// ── Zero-padding test ──

test("ScopeEngine: readDisplayWindow zero-pads when display ring is short", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.zeroPadEnabled = true;
    e.start();

    e.pushSample(100, 5, 1);
    // Only 1 bucket, ask for 3 with default padding
    const w = e.readDisplayWindow(3);
    assert.equal(w.timestamps.length, 3);
    assert.equal(w.avgV[0], 0); // padded
    assert.equal(w.avgV[1], 0); // padded
    assert.equal(w.avgV[2], 5); // real
    // Timestamps should be monotonic
    assert.ok(w.timestamps[0] < w.timestamps[1]);
    assert.ok(w.timestamps[1] < w.timestamps[2]);
    e.pause();
});

test("ScopeEngine: zeroPadEnabled=false skips padding", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.zeroPadEnabled = false;
    e.start();

    e.pushSample(100, 5, 1);
    const w = e.readDisplayWindow(3);
    assert.equal(w.timestamps.length, 1); // only real data
    assert.equal(w.avgV[0], 5);
    e.pause();
});

// ── Cursor-based read tests ──

test("ScopeEngine: readDisplayWindow +ve count reads leftward from cursor", () => {
    resetTs();
    const e = new ScopeEngine(30, 20, 1);
    e.start();

    injectObservations(e, 10);
    e.followIngest = false;

    // cursor=0.9 → right edge at round(0.9*30)=27
    // 4 leftward: [23..27) → physical: p=23-20=3 → timestamps [3,4,5,6]
    e.setCursorToFraction(0.9);
    const w = e.readDisplayWindow(4, false);
    assert.equal(w.timestamps.length, 4);
    assert.deepEqual(Array.from(w.timestamps), [3, 4, 5, 6]);
    e.pause();
});

test("ScopeEngine: readDisplayWindow -ve count reads rightward from cursor", () => {
    resetTs();
    const e = new ScopeEngine(30, 20, 1);
    e.start();

    injectObservations(e, 10);
    e.followIngest = false;

    // cursor=0.8 → right edge at round(0.8*30)=24
    // 3 rightward: [24..27) → physical: p=24-20=4 → timestamps [4,5,6]
    e.setCursorToFraction(0.8);
    const w = e.readDisplayWindow(-3, false);
    assert.equal(w.timestamps.length, 3);
    assert.deepEqual(Array.from(w.timestamps), [4, 5, 6]);
    e.pause();
});

test("ScopeEngine: readDisplayWindow cursor at 1 reads newest data", () => {
    resetTs();
    const e = new ScopeEngine(30, 20, 1);
    e.start();

    injectObservations(e, 10);
    e.followIngest = false;

    // cursor=1.0 → right edge at 30
    // 4 leftward: [26..30) → physical: p=26-20=6 → timestamps [6,7,8,9]
    e.setCursorToFraction(1.0);
    let w = e.readDisplayWindow(4, false);
    assert.deepEqual(Array.from(w.timestamps), [6, 7, 8, 9]);

    // -ve rightward from head should be empty
    w = e.readDisplayWindow(-4, false);
    assert.equal(w.timestamps.length, 0);
    e.pause();
});

test("ScopeEngine: readDisplayWindow cursor at 0 reads oldest data", () => {
    resetTs();
    const e = new ScopeEngine(30, 20, 1);
    e.start();

    injectObservations(e, 10);
    e.followIngest = false;

    // cursor=0.0 → right edge at 0 → nothing to read leftward
    e.setCursorToFraction(0.0);
    let w = e.readDisplayWindow(4, false);
    assert.equal(w.timestamps.length, 0);

    // cursor=0.7 → right edge at round(0.7*30)=21
    // 4 rightward: [21..25) → physical: p=21-20=1 → timestamps [1,2,3,4]
    e.setCursorToFraction(0.7);
    w = e.readDisplayWindow(-4, false);
    assert.equal(w.timestamps.length, 4);
    assert.deepEqual(Array.from(w.timestamps), [1, 2, 3, 4]);
    e.pause();
});

// ── Simulator test ──

test("Simulator: advances timestamp and produces packets", () => {
    const sim = new Simulator(10, 1, 1);
    const a = sim.next();
    const b = sim.next();
    assert.equal(b.timestampUs - a.timestampUs, 100_000); // 1/10 Hz → 100k μs
    assert.ok(a.samples[0].volts > 0);
});

// ── Decode round-trip test ──

function pkt(tsUs: number, volts: number, amps: number): DecodedPacket {
    return {
        timestampUs: tsUs,
        dataCount: 1,
        samples: [{ range: 1, volAdc: 0, curAdc: 0, refAdc: 0, volts, amps }],
    };
}

test("decodePacket round-trips through buildPacket helper", () => {
    const buf = new Uint8Array(11 + 7);
    buf[0] = 0xaa;
    buf[1] = 0x55;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(2, 999n, true);
    buf[10] = 1;
    buf[11] = 1; // range
    dv.setUint16(12, 2000, true);
    dv.setUint16(14, 1500, true);
    dv.setUint16(16, 1000, true);
    const d = decodePacket(buf);
    assert.equal(d.timestampUs, 999);
    assert.ok(Math.abs(d.samples[0].volts - 2000 * (3000 / 4095) * (11 / 1000)) < 1e-9);
});
