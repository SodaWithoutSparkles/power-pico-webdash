// Simulated packet generator running in a Web Worker.
// Uses elapsed real time to determine how many packets to generate per tick,
// achieving accurate 10k samples/s (10 samples × 1000 packets/s) regardless
// of timer resolution limits (~4-16ms on most browsers).
//
// The accumulated-counter approach: each tick, add (rate × tickDuration) to an
// accumulator; generate floor(accumulator) packets; subtract from accumulator.
// This ensures the correct average rate even with coarse/irregular ticks.

import { LOW_CUR, type DecodedPacket, type Sample } from "../decode/decode";

const PKT_RATE_HZ = 1000;
const SAMPLES_PER_PACKET = 10;
const FREQ_HZ = 0.5;
const DT_US = 1_000_000 / PKT_RATE_HZ;
const TICK_MS = 5;

let tUs = 0;
let accumulator = 0;
let running = false;

function generatePackets(count: number): DecodedPacket[] {
    const packets: DecodedPacket[] = new Array(count);
    for (let i = 0; i < count; i++) {
        const phase = (tUs / 1_000_000) * 2 * Math.PI * FREQ_HZ;
        const volts = 5 + 2 * Math.sin(phase);
        const amps = 0.5 + 0.2 * Math.sin(phase * 0.5) + (Math.random() - 0.5) * 0.05;
        const samples: Sample[] = new Array(SAMPLES_PER_PACKET);
        for (let k = 0; k < SAMPLES_PER_PACKET; k++) {
            samples[k] = {
                range: LOW_CUR,
                volAdc: 0,
                curAdc: 0,
                refAdc: 0,
                volts,
                amps,
            };
        }
        packets[i] = {
            timestampUs: Math.round(tUs),
            dataCount: SAMPLES_PER_PACKET,
            samples,
        };
        tUs += DT_US;
    }
    return packets;
}

function tick() {
    if (!running) return;
    accumulator += (PKT_RATE_HZ * TICK_MS) / 1000;
    const toGenerate = Math.floor(accumulator);
    if (toGenerate > 0) {
        accumulator -= toGenerate;
        const packets = generatePackets(toGenerate);
        self.postMessage({ type: "packets", packets });
    }
    setTimeout(tick, TICK_MS);
}

self.onmessage = (e: MessageEvent) => {
    switch (e.data.type) {
        case "start":
            running = false; // stop any previous loop
            tUs = 0;
            accumulator = 0;
            running = true;
            tick();
            break;
        case "stop":
            running = false;
            break;
    }
};
