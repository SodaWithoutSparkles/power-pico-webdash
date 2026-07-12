// Sliding window of the last `size` packets. Emits one averaged DisplayPoint
// per packet once the window is full — oscilloscope-like time base (matches
// decode.py's deque(maxlen=20) behaviour).

import type { DecodedPacket } from "./decode";
import type { DisplayPoint } from "./engineTypes";

export class AveragingBuffer {
    private packets: DecodedPacket[] = [];

    constructor(size: number) {
        this.size = size;
    }

    size: number;

    // Returns the averaged point when the window is full, else null.
    push(pkt: DecodedPacket): DisplayPoint | null {
        this.packets.push(pkt);
        if (this.packets.length > this.size) this.packets.shift();
        if (this.packets.length < this.size) return null;
        return this.average();
    }

    private average(): DisplayPoint {
        let sumV = 0;
        let sumI = 0;
        let n = 0;
        for (const pkt of this.packets) {
            for (const s of pkt.samples) {
                sumV += s.volts;
                sumI += s.amps;
                n++;
            }
        }
        const v = n > 0 ? sumV / n : 0;
        const i = n > 0 ? sumI / n : 0;
        const w = v * i;
        const t = this.packets[this.packets.length - 1].timestampUs;
        return { t, v, i, w };
    }

    clear(): void {
        this.packets = [];
    }

    resize(size: number): void {
        this.size = size;
        if (this.packets.length > size) {
            this.packets.splice(0, this.packets.length - size);
        }
    }
}
