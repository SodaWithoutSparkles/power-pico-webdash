import { test, expect } from 'bun:test';
import assert from "node:assert/strict";

import { ScopeEngine } from "./ingest/ScopeEngine.ts";
import { Simulator } from "./ingest/simulate.ts";
import { decodePacket, type DecodedPacket } from "./decode/decode.ts";


// ── ScopeEngine tests ──

let _testTs = 0;

function resetTs(): void { _testTs = 0; }

/** Push `count` samples with globally monotonic timestamps. Returns the injected timestamps. */
function injectSamples(e: ScopeEngine, count: number): number[] {
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
    assert.equal(e.getLatestWindow(10).timestamps.length, 0);

    e.pushSample(2, 3, 0); // temp ring hits 3 → flushes a bucket
    const w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 1);
    assert.equal(w.avgV[0], 2); // (1+2+3)/3
    assert.equal(w.maxV[0], 3);
    assert.equal(w.minV[0], 1);

    // Push 3 more → second bucket
    e.pushSample(3, 10, 0);
    e.pushSample(4, 20, 0);
    e.pushSample(5, 30, 0);
    assert.equal(e.getLatestWindow(10).timestamps.length, 2);

    e.pause();
});

test("ScopeEngine: avgWindowSize=1 streams every sample directly", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(10, 5, 1);
    e.pushSample(20, 7, 2);

    const w = e.getLatestWindow(10);
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
    const w = e.getLatestWindow(10);
    assert.equal(w.timestamps[0], 0); // 1000 - 1000 = 0

    e.pause();
});

test("ScopeEngine: clear empties display rings", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(0, 1, 0);
    assert.equal(e.getLatestWindow(10).timestamps.length, 1);

    e.clear();
    assert.equal(e.getLatestWindow(10).timestamps.length, 0);

    e.pause();
});

test("ScopeEngine: followIngest=true always returns latest window", () => {
    resetTs();
    const e = new ScopeEngine(1000, 10, 1);
    e.start();
    e.followIngest = true;

    injectSamples(e, 5);
    // followIngest → cursor snaps to end → getLatestWindow returns latest
    let w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 5);
    assert.equal(w.timestamps[w.timestamps.length - 1], 4); // last = newest

    injectSamples(e, 1);  // push 1 more, total 6
    w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 6);
    assert.equal(w.timestamps[w.timestamps.length - 1], 5); // newest

    injectSamples(e, 4);  // total 10
    w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 10);
    assert.equal(w.timestamps[w.timestamps.length - 1], 9); // newest

    e.pause();
});

test("ScopeEngine: followIngest=false pins window to trace", () => {
    resetTs();
    const e = new ScopeEngine(1000, 20, 1); // display=20, enough room
    e.start();
    e.followIngest = false;

    injectSamples(e, 10);
    e.setCursorToEnd(); // explicitly pin cursor to end (offset=len)
    // getLatestWindow reads from cursor when !followIngest
    let w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 10); // len=10, cursor=10, reads [0,10)
    const t1 = Array.from(w.timestamps);
    assert.deepEqual(t1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    injectSamples(e, 5); // total 15
    // cursor offset stays 10 (pinned) — window still shows [0, 10)
    w = e.getLatestWindow(10);
    assert.deepEqual(Array.from(w.timestamps), t1, "window pinned to trace");
    e.pause();
});

test("ScopeEngine: followIngest=false caps at end of raw trace", () => {
    resetTs();
    const e = new ScopeEngine(30, 10, 1); // display capacity=10
    e.start();
    e.followIngest = false;

    injectSamples(e, 15); // display wrapped once: tail has advanced
    // Pin cursor to end, then scroll to 50%
    e.setCursorToEnd();
    e.setCursorToFraction(0.5);
    // offset=5, cursor=5, reads [0, 5)
    let w = e.getLatestWindow(10);
    assert.equal(w.timestamps.length, 5);
    const t1 = Array.from(w.timestamps);

    injectSamples(e, 5); // total 20: display wrapped more, tail advanced
    // cursor offset stays 5 from tail → reads from NEW tail → different data
    w = e.getLatestWindow(10);
    const t2 = Array.from(w.timestamps);
    // t2 should be "newer" than t1 since cursor is same offset from advanced tail
    assert.ok(t2[0] > t1[0], "window advanced because trace end moved");
    e.pause();
});


test("ScopeEngine: setDisplayWindow reconfigures display rings", () => {
    const e = new ScopeEngine(1000, 10, 1);
    e.start();

    e.pushSample(0, 1, 0);
    e.pushSample(1, 2, 0);
    assert.equal(e.getLatestWindow(10).timestamps.length, 2);

    // Rebuild display rings with smaller capacity — replays from raw ring
    e.setDisplayWindow(3, 1);
    assert.equal(e.getLatestWindow(10).timestamps.length, 2, "replayed from raw ring");

    e.pushSample(2, 3, 0);
    e.pushSample(3, 4, 0);
    e.pushSample(4, 5, 0);
    e.pushSample(5, 6, 0); // pushes out first two samples (only capacity 3)
    assert.equal(e.getLatestWindow(10).timestamps.length, 3);
    assert.deepEqual(Array.from(e.getLatestWindow(10).timestamps), [3, 4, 5]);

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
