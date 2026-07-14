/// <reference lib="webworker" />

// Web Worker entry point for the scope engine.
// Owns the ring buffer, packet parser, simulator, and integrators.

import { PacketParser } from "./decode";
import { TelemetryRingBuffer } from "./TelemetryRingBuffer";
import { bucketData, bucketDataSince } from "./FormatEngine";
import { DualStageIntegrator, integrateRange } from "./integrator";
import { Simulator } from "./simulate";
import type { WorkerRequest, WorkerResponse, StatusPayload, BucketedTelemetryData } from "./workerTypes";

// ── Worker state ──

let ring: TelemetryRingBuffer;
let parser: PacketParser;
let integrator: DualStageIntegrator;
let simulator: Simulator | null = null;
let simulateInterval: ReturnType<typeof setInterval> | null = null;

let running = false;
let mode: "idle" | "serial" | "simulate" = "idle";
let pktPerSec = 0;
let sampleCount = 0;
let lastStatusTs = 0;
let pktCountSinceStatus = 0;
let tZeroOffset = 0; // μs offset subtracted for display

// Serial port (if connected)
let serialPort: SerialPort | null = null;
let serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

// Status throttle: emit status at most every 250ms
const STATUS_INTERVAL_MS = 250;

// ── Helpers ──

function emitStatus(): void {
    const now = performance.now();
    const dtMs = now - lastStatusTs;
    // Compute pkt/s from the count accumulated since last status
    if (dtMs > 0) {
        pktPerSec = Math.round((pktCountSinceStatus / dtMs) * 1000);
    }
    lastStatusTs = now;

    const liveI = ring.length > 0 ? ring.currents[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1] : 0;
    const liveV = ring.length > 0 ? ring.voltages[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1] : 0;

    const payload: StatusPayload = {
        running,
        mode,
        pktPerSec,
        sampleCount,
        bufferFillPct: ring.fillPct,
        liveV,
        liveI,
        liveW: liveV * liveI,
        lastTimestampUs: ring.length > 0
            ? Number(ring.timestamps[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1])
            : 0,
    };
    pktCountSinceStatus = 0;
    postMessage({ type: "status", payload } satisfies WorkerResponse);
}

function postError(msg: string): void {
    postMessage({ type: "error", message: msg } satisfies WorkerResponse);
}

/** Extract transferable buffers from a BucketedTelemetryData for zero-copy postMessage. */
function bucketedTransferables(data: BucketedTelemetryData): Transferable[] {
    return [
        data.timestamps.buffer as ArrayBuffer,
        data.avgV.buffer as ArrayBuffer,
        data.minV.buffer as ArrayBuffer,
        data.maxV.buffer as ArrayBuffer,
        data.avgI.buffer as ArrayBuffer,
        data.minI.buffer as ArrayBuffer,
        data.maxI.buffer as ArrayBuffer,
    ];
}

// ── Ingest ──

function ingestPacket(
    tsUs: number,
    avgV: number,
    avgI: number,
): void {
    // Apply T+0 offset
    const adjustedTs = BigInt(tsUs) - BigInt(tZeroOffset);
    ring.push(adjustedTs, avgV, avgI);
    integrator.push(adjustedTs, avgV, avgI);
    sampleCount++;
    pktCountSinceStatus++;
}

function handlePackets(packets: import("./decode").DecodedPacket[]): void {
    for (const pkt of packets) {
        let sumV = 0;
        let sumI = 0;
        for (const s of pkt.samples) {
            sumV += s.volts;
            sumI += s.amps;
        }
        const avgV = sumV / pkt.samples.length;
        const avgI = sumI / pkt.samples.length;
        ingestPacket(pkt.timestampUs, avgV, avgI);
    }
}

// ── Serial read loop ──

async function startSerialRead(port: SerialPort): Promise<void> {
    try {
        serialReader = port.readable!.getReader();

        while (running && serialReader) {
            const { value, done } = await serialReader.read();
            if (done) break;
            if (!value) continue;

            const packets = parser.push(value);
            handlePackets(packets);
            emitStatus();
        }
    } catch (err) {
        postError(`Serial read error: ${err}`);
    } finally {
        if (serialReader) {
            try { serialReader.cancel(); } catch { /* ignore */ }
            serialReader = null;
        }
        if (running && mode === "serial") {
            running = false;
            mode = "idle";
            emitStatus();
        }
    }
}

// ── Message handler ──

onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;

    switch (msg.type) {
        case "init": {
            ring = new TelemetryRingBuffer(msg.config.capacity);
            parser = new PacketParser();
            integrator = new DualStageIntegrator();
            lastStatusTs = performance.now();
            break;
        }

        case "start": {
            if (ring === undefined) {
                postError("Worker not initialized");
                break;
            }
            running = true;
            emitStatus();
            break;
        }

        case "pause": {
            running = false;
            if (simulateInterval !== null) {
                clearInterval(simulateInterval);
                simulateInterval = null;
            }
            if (serialReader) {
                try { serialReader.cancel(); } catch { /* ignore */ }
                serialReader = null;
            }
            emitStatus();
            break;
        }

        case "clear": {
            ring.clear();
            parser.reset();
            integrator.reset();
            sampleCount = 0;
            pktPerSec = 0;
            pktCountSinceStatus = 0;
            emitStatus();
            break;
        }

        case "connect-serial": {
            if (ring === undefined) {
                postError("Worker not initialized");
                break;
            }
            try {
                const port = await navigator.serial.requestPort();
                await port.open({ baudRate: 115200 });
                serialPort = port;
                mode = "serial";
                running = true;
                parser.reset();
                startSerialRead(port);
                emitStatus();
            } catch (err) {
                postError(`Serial connect failed: ${err}`);
            }
            break;
        }

        case "disconnect": {
            running = false;
            mode = "idle";
            if (serialReader) {
                try { serialReader.cancel(); } catch { /* ignore */ }
                serialReader = null;
            }
            if (serialPort) {
                try { serialPort.close(); } catch { /* ignore */ }
                serialPort = null;
            }
            emitStatus();
            break;
        }

        case "start-simulate": {
            if (ring === undefined) {
                postError("Worker not initialized");
                break;
            }
            simulator = new Simulator(100, 1, 0.5); // 100 pkt/s
            mode = "simulate";
            running = true;

            if (simulateInterval) clearInterval(simulateInterval);
            simulateInterval = setInterval(() => {
                if (!running || !simulator) return;
                const pkt = simulator.next();
                handlePackets([pkt]);
                emitStatus();
            }, 10); // 100 pkt/s → one packet every 10ms
            emitStatus();
            break;
        }

        case "stop-simulate": {
            if (simulateInterval !== null) {
                clearInterval(simulateInterval);
                simulateInterval = null;
            }
            simulator = null;
            if (mode === "simulate") {
                mode = "idle";
                running = false;
            }
            emitStatus();
            break;
        }

        case "get-data-since": {
            if (!ring) { postError("Not initialized"); break; }
            const data = bucketDataSince(ring, msg.sinceTs, msg.bucketCount);
            self.postMessage(
                { type: "bucketed-data", payload: data } satisfies WorkerResponse,
                bucketedTransferables(data),
            );
            break;
        }

        case "get-data-window": {
            if (!ring || ring.length === 0) { postError("No data"); break; }
            const headTs = ring.timestamps[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1];
            const tailIdx = ring.tailIdx;
            const tailTs = ring.timestamps[tailIdx];
            const range = Number(headTs - tailTs);
            const startTs = tailTs + BigInt(Math.floor(range * msg.fromFraction));
            const endTs = tailTs + BigInt(Math.floor(range * msg.toFraction));
            const data = bucketData(ring, startTs, endTs, msg.bucketCount);
            self.postMessage(
                { type: "window-data", payload: data } satisfies WorkerResponse,
                bucketedTransferables(data),
            );
            break;
        }

        case "get-frac-by-ts": {
            if (!ring || ring.length === 0) { postError("No data"); break; }
            const tailIdx = ring.tailIdx;
            const headTs = ring.timestamps[ring.headIdx === 0 ? ring.capacity - 1 : ring.headIdx - 1];
            const tailTs = ring.timestamps[tailIdx];
            const range = Number(headTs - tailTs);
            const idx = ring.binarySearch(msg.targetTs);
            if (idx < 0) { postMessage({ type: "frac", payload: 1 } satisfies WorkerResponse); break; }
            const frac = range > 0 ? Number(ring.timestamps[idx] - tailTs) / range : 0;
            postMessage({ type: "frac", payload: frac } satisfies WorkerResponse);
            break;
        }

        case "set-t-zero": {
            tZeroOffset = msg.rawTsUs;
            break;
        }

        case "reset-t-zero": {
            tZeroOffset = 0;
            break;
        }

        case "get-integration": {
            if (!ring) { postError("Not initialized"); break; }
            const result = integrateRange(ring, msg.startTs, msg.endTs);
            postMessage({ type: "integration-result", payload: result } satisfies WorkerResponse);
            break;
        }
    }
};
