// Simulated packet generator running in a Web Worker.
// Uses *real elapsed wall-clock time* between ticks (not a fixed interval)
// so the packet rate stays accurate regardless of timer jitter or computer load.
//
// Accumulated-counter approach: each tick, add (rate × realElapsedMs / 1000)
// to an accumulator; generate floor(accumulator) packets; subtract from accumulator.
// This ensures the correct average rate even with coarse/irregular ticks.
//
// Timestamp is persisted across stop/start so the waveform is continuous.
// State is saved in the parent ScopeEngine (since terminate() kills the worker).

import { LOW_CUR, type DecodedPacket, type Sample } from "../decode/decode";

const PKT_RATE_HZ = 1_000;       // 1000 packets/s
const SAMPLES_PER_PACKET = 10;   // 10 samples/packet → 10k samples/s
const FREQ_HZ = 0.5;
const DT_US = 1_000_000 / PKT_RATE_HZ; // 1000 µs per packet
const TICK_MS = 5;

let tUs = 0;
let accumulator = 0;
let running = false;
let lastTick = 0;               // performance.now() of the last tick call

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
    const now = performance.now();
    const elapsedMs = lastTick > 0 ? now - lastTick : TICK_MS;
    lastTick = now;

    accumulator += (PKT_RATE_HZ * elapsedMs) / 1000;
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
        case "start": {
            running = false; // stop any previous loop
            const { savedTUs = 0, savedWallMs = 0, nowPerf = 0 } = e.data;
            if (savedWallMs > 0 && nowPerf > savedWallMs) {
                const gapUs = Math.round((nowPerf - savedWallMs) * 1000);
                tUs = savedTUs + gapUs;
            } else {
                tUs = savedTUs;
            }
            accumulator = 0;
            lastTick = 0;
            running = true;
            tick();
            break;
        }
        case "stop":
            running = false;
            break;
    }
};
