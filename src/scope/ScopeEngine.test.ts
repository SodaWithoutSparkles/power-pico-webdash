import { test } from "node:test";
import assert from "node:assert/strict";

import { ScopeEngine } from "./ScopeEngine.ts";
import { DisplayRingBuffer } from "./DisplayRingBuffer.ts";
import { AveragingBuffer } from "./AveragingBuffer.ts";
import { Simulator } from "./simulate.ts";
import { decodePacket, type DecodedPacket } from "./decode.ts";

function pkt(tsUs: number, volts: number, amps: number): DecodedPacket {
    return {
        timestampUs: tsUs,
        dataCount: 1,
        samples: [{ range: 1, volAdc: 0, curAdc: 0, refAdc: 0, volts, amps }],
    };
}

test("AveragingBuffer: emits null until window full, then averages", () => {
    const ab = new AveragingBuffer(3);
    assert.equal(ab.push(pkt(0, 1, 0)), null);
    assert.equal(ab.push(pkt(1, 2, 0)), null);
    const p = ab.push(pkt(2, 3, 0));
    assert.ok(p);
    assert.equal(p!.v, 2); // (1+2+3)/3
    assert.equal(p!.t, 2);
});

test("AveragingBuffer: slides window (FIFO)", () => {
    const ab = new AveragingBuffer(2);
    ab.push(pkt(0, 10, 0));
    const p = ab.push(pkt(1, 20, 0));
    assert.equal(p!.v, 15); // only last 2
});

test("DisplayRingBuffer: scrolling overwrite + chronological snapshot", () => {
    const ring = new DisplayRingBuffer(3);
    ring.push({ t: 1, v: 1, i: 0, w: 0 });
    ring.push({ t: 2, v: 2, i: 0, w: 0 });
    ring.push({ t: 3, v: 3, i: 0, w: 0 });
    ring.push({ t: 4, v: 4, i: 0, w: 0 }); // overwrites t=1
    const s = ring.snapshot();
    assert.deepEqual(Array.from(s.t), [2, 3, 4]);
    assert.equal(ring.fillPct, 1);
});

test("DisplayRingBuffer: resize preserves recent points", () => {
    const ring = new DisplayRingBuffer(5);
    for (let k = 0; k < 5; k++) ring.push({ t: k, v: k, i: 0, w: 0 });
    ring.resize(3);
    const s = ring.snapshot();
    assert.deepEqual(Array.from(s.t), [2, 3, 4]);
});

test("Simulator: advances timestamp and produces packets", () => {
    const sim = new Simulator(10, 1, 1);
    const a = sim.next();
    const b = sim.next();
    assert.equal(b.timestampUs - a.timestampUs, 100_000); // 1/10 Hz
    assert.ok(a.samples[0].volts > 0);
});

test("ScopeEngine: averaging pipeline fills ring after k packets", () => {
    const e = new ScopeEngine();
    e.setConfig({ avgSize: 2, windowSize: 10 });
    e.start();
    e.pushPacket(pkt(0, 2, 1));
    e.pushPacket(pkt(1, 4, 1));
    const s = e.snapshot();
    assert.equal(s.t.length, 1);
    assert.equal(s.v[0], 3); // (2+4)/2
    assert.equal(s.w[0], 3); // v*i
    e.pause();
});

test("ScopeEngine: T+0 offset shifts displayed x", () => {
    const e = new ScopeEngine();
    e.setConfig({ avgSize: 1, windowSize: 10 });
    e.setTZero(1000);
    e.start();
    e.pushPacket(pkt(1000, 5, 1));
    const s = e.snapshot();
    assert.equal(s.t[0], 0); // 1000 - 1000
    e.pause();
});

test("ScopeEngine: backward jump > 1s auto-shifts T+0", () => {
    const e = new ScopeEngine();
    e.setConfig({ avgSize: 1, windowSize: 10 });
    e.start();
    e.pushPacket(pkt(5_000_000, 5, 1));
    e.pushPacket(pkt(1000, 5, 1)); // jump back > 1s
    const s = e.snapshot();
    // second point displayT = 1000 - (5_000_000 - 1000) = -4_999_000
    assert.equal(s.t[1], 1000 - (5_000_000 - 1000));
    e.pause();
});

test("ScopeEngine: clear empties ring", () => {
    const e = new ScopeEngine();
    e.setConfig({ avgSize: 1, windowSize: 10 });
    e.start();
    e.pushPacket(pkt(0, 5, 1));
    e.clear();
    assert.equal(e.snapshot().t.length, 0);
    e.pause();
});

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
