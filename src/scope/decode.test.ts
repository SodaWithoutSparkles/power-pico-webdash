import { test } from "node:test";
import assert from "node:assert/strict";

import {
    PacketParser,
    decodePacket,
    HEADER,
    LOW_CUR,
    MID_CUR,
    HIGH_CUR,
    VOLTS_PER_ADC_LSB,
    SCALE_LOW_UA_PER_LSB,
    SCALE_MID_UA_PER_LSB,
    SCALE_HIGH_UA_PER_LSB,
} from "./decode.ts";

// Build a raw packet matching the protocol:
// header(2) | ts(8 LE) | count(1) | count * (range, vol, cur, ref) each 2-byte LE.
function buildPacket(tsUs: number, samples: Array<[number, number, number, number]>): Uint8Array {
    const buf = new Uint8Array(11 + samples.length * 7);
    buf[0] = 0xaa;
    buf[1] = 0x55;
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(2, BigInt(tsUs), true);
    buf[10] = samples.length;
    let off = 11;
    for (const [range, vol, cur, ref] of samples) {
        buf[off] = range;
        dv.setUint16(off + 1, vol, true);
        dv.setUint16(off + 3, cur, true);
        dv.setUint16(off + 5, ref, true);
        off += 7;
    }
    return buf;
}

test("decodePacket: volts and amps math matches decode.py", () => {
    const volAdc = 2000;
    const curAdc = 1500;
    const refAdc = 1000;
    const pkt = buildPacket(123456, [[LOW_CUR, volAdc, curAdc, refAdc]]);

    const d = decodePacket(pkt);
    assert.equal(d.timestampUs, 123456);
    assert.equal(d.dataCount, 1);

    const s = d.samples[0];
    assert.equal(s.volAdc, volAdc);
    assert.equal(s.curAdc, curAdc);
    assert.equal(s.refAdc, refAdc);
    assert.equal(s.volts, volAdc * VOLTS_PER_ADC_LSB);
    assert.equal(s.amps, ((curAdc - refAdc) * SCALE_LOW_UA_PER_LSB) / 1_000_000.0);
});

test("decodePacket: each current range uses its own scale", () => {
    const cur = 2000;
    const ref = 1000;
    const low = decodePacket(buildPacket(1, [[LOW_CUR, 100, cur, ref]])).samples[0];
    const mid = decodePacket(buildPacket(1, [[MID_CUR, 100, cur, ref]])).samples[0];
    const high = decodePacket(buildPacket(1, [[HIGH_CUR, 100, cur, ref]])).samples[0];

    assert.equal(low.amps, ((cur - ref) * SCALE_LOW_UA_PER_LSB) / 1e6);
    assert.equal(mid.amps, ((cur - ref) * SCALE_MID_UA_PER_LSB) / 1e6);
    assert.equal(high.amps, ((cur - ref) * SCALE_HIGH_UA_PER_LSB) / 1e6);
    assert.notEqual(low.amps, mid.amps);
});

test("decodePacket: multiple samples in one packet", () => {
    const pkt = buildPacket(999, [
        [LOW_CUR, 100, 200, 150],
        [MID_CUR, 300, 400, 350],
        [HIGH_CUR, 500, 600, 550],
    ]);
    const d = decodePacket(pkt);
    assert.equal(d.dataCount, 3);
    assert.equal(d.samples.length, 3);
    assert.equal(d.samples[2].volts, 500 * VOLTS_PER_ADC_LSB);
});

test("decodePacket: rejects bad header and short packet", () => {
    assert.throws(() => decodePacket(new Uint8Array([0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0])), /bad packet header/);
    assert.throws(() => decodePacket(new Uint8Array([0xaa, 0x55, 0, 0])), /packet too short/);
});

test("PacketParser: emits complete packet from one chunk", () => {
    const p = new PacketParser();
    const pkt = buildPacket(42, [[LOW_CUR, 10, 20, 15]]);
    const out = p.push(pkt);
    assert.equal(out.length, 1);
    assert.equal(out[0].timestampUs, 42);
});

test("PacketParser: reassembles packet split across chunks", () => {
    const p = new PacketParser();
    const pkt = buildPacket(777, [[MID_CUR, 100, 200, 150], [LOW_CUR, 50, 60, 55]]);
    const mid = Math.floor(pkt.length / 2);
    const first = p.push(pkt.subarray(0, mid));
    assert.equal(first.length, 0, "no complete packet yet");
    const second = p.push(pkt.subarray(mid));
    assert.equal(second.length, 1);
    assert.equal(second[0].dataCount, 2);
});

test("PacketParser: handles multiple packets in one chunk + trailing partial", () => {
    const p = new PacketParser();
    const a = buildPacket(1, [[LOW_CUR, 1, 2, 1]]);
    const b = buildPacket(2, [[LOW_CUR, 3, 4, 2]]);
    const c = buildPacket(3, [[LOW_CUR, 5, 6, 3]]); // partial: drop last 3 bytes
    const out = p.push(concatAll([a, b, c.subarray(0, c.length - 3)]));
    assert.equal(out.length, 2);
    assert.equal(out[0].timestampUs, 1);
    assert.equal(out[1].timestampUs, 2);
    // Feed the rest of c; parser should complete it.
    const rest = p.push(c.subarray(c.length - 3));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].timestampUs, 3);
});

test("PacketParser: skips garbage before header", () => {
    const p = new PacketParser();
    const garbage = new Uint8Array([0x11, 0x22, 0x33]);
    const pkt = buildPacket(55, [[HIGH_CUR, 9, 9, 9]]);
    const out = p.push(concatAll([garbage, pkt]));
    assert.equal(out.length, 1);
    assert.equal(out[0].timestampUs, 55);
});

test("PacketParser: resyncs after a malformed header", () => {
    const p = new PacketParser();
    // Valid-length packet with an invalid range byte (99) -> decodePacket throws,
    // parser drops 1 byte and rescans for the real header that follows.
    const junk = buildPacket(0, [[99, 1, 2, 1]]);
    const good = buildPacket(88, [[LOW_CUR, 1, 2, 1]]);
    const out = p.push(concatAll([junk, good]));
    assert.equal(out.length, 1);
    assert.equal(out[0].timestampUs, 88);
});

test("HEADER constant sanity", () => {
    assert.equal(HEADER, 0xaa55);
});

function concatAll(parts: Uint8Array[]): Uint8Array {
    const len = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}
