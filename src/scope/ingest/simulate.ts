// Synthetic packet generator so the scope runs without hardware.
// Sine voltage + noisy current; timestamp advances at pktRateHz.
// Matches real hardware: 10 samples/packet, 1 packet/ms, 10k samples/s.

import { LOW_CUR, type DecodedPacket, type Sample } from "../decode/decode.ts";

export class Simulator {
    private tUs = 0;
    private readonly dtUs: number;
    private _interval: ReturnType<typeof setInterval> | null = null;

    constructor(
        pktRateHz = 1000,
        samplesPerPacket = 10,
        freqHz = 0.5,
    ) {
        this.pktRateHz = pktRateHz;
        this.samplesPerPacket = samplesPerPacket;
        this.freqHz = freqHz;
        this.dtUs = 1_000_000 / pktRateHz;
    }

    readonly pktRateHz: number;
    readonly samplesPerPacket: number;
    readonly freqHz: number;

    get running(): boolean {
        return this._interval !== null;
    }

    reset(): void {
        this.tUs = 0;
    }

    next(): DecodedPacket {
        const phase = (this.tUs / 1_000_000) * 2 * Math.PI * this.freqHz;
        const volts = 5 + 2 * Math.sin(phase);
        const amps = 0.5 + 0.2 * Math.sin(phase * 0.5) + (Math.random() - 0.5) * 0.05;
        const samples: Sample[] = [];
        for (let k = 0; k < this.samplesPerPacket; k++) {
            samples.push({
                range: LOW_CUR,
                volAdc: 0,
                curAdc: 0,
                refAdc: 0,
                volts,
                amps,
            });
        }
        const pkt: DecodedPacket = {
            timestampUs: Math.round(this.tUs),
            dataCount: this.samplesPerPacket,
            samples,
        };
        this.tUs += this.dtUs;
        return pkt;
    }

    /**
     * Start generating packets in a setInterval loop.
     * Calls `onPacket(pkt)` for each generated packet.
     */
    startLoop(onPacket: (pkt: DecodedPacket) => void): void {
        if (this._interval !== null) return;
        this._interval = setInterval(() => {
            if (!this.running) return;
            onPacket(this.next());
        }, 1000 / this.pktRateHz);
    }

    /** Stop the interval loop. */
    stopLoop(): void {
        if (this._interval !== null) {
            clearInterval(this._interval);
            this._interval = null;
        }
    }
}
