// Pure, DOM-free decode of the Power Pico serial protocol.
// Math ported 1:1 from references/decode.py. No allocations beyond what parsing needs.

export const HEADER = 0xaa55;

export const LOW_CUR = 1;
export const MID_CUR = 2;
export const HIGH_CUR = 3;

// uA per ADC LSB for each current range (decode.py: SCALE_*_UA_PER_LSB).
export const SCALE_LOW_UA_PER_LSB = (3.0 / 4096.0 / 50.0 / 50.0) * 1_000_000.0;
export const SCALE_MID_UA_PER_LSB = (3.0 / 4096.0 / 50.0 / 0.5) * 1_000_000.0;
export const SCALE_HIGH_UA_PER_LSB = (3.0 / 4096.0 / 50.0 / 0.005) * 1_000_000.0;

// V per ADC LSB (decode.py: VOLTS_PER_ADC_LSB).
export const VOLTS_PER_ADC_LSB = (3000.0 / 4095.0) * (11.0 / 1000.0);

export const HEADER_BYTES = 2;
export const TIMESTAMP_BYTES = 8;
export const COUNT_BYTES = 1;
export const SAMPLE_BYTES = 7;
export const FIXED_BYTES = HEADER_BYTES + TIMESTAMP_BYTES + COUNT_BYTES; // 11

export interface Sample {
    range: number;
    volAdc: number;
    curAdc: number;
    refAdc: number;
    volts: number;
    amps: number;
}

export interface DecodedPacket {
    timestampUs: number;
    dataCount: number;
    samples: Sample[];
}

function currentUa(curAdc: number, refAdc: number, rng: number): number {
    const delta = curAdc - refAdc;
    let scale: number;
    if (rng === LOW_CUR) scale = SCALE_LOW_UA_PER_LSB;
    else if (rng === MID_CUR) scale = SCALE_MID_UA_PER_LSB;
    else if (rng === HIGH_CUR) scale = SCALE_HIGH_UA_PER_LSB;
    else throw new Error(`invalid range value: ${rng}`);
    return delta * scale;
}

export function decodePacket(packet: Uint8Array): DecodedPacket {
    if (packet.length < FIXED_BYTES) throw new Error("packet too short");
    if (packet[0] !== 0xaa || packet[1] !== 0x55) throw new Error("bad packet header");

    // Timestamp: little-endian uint64. JS numbers lose precision past 2^53;
    // device μs counter wraps at ~585k years, so Number is safe for display math.
    //
    // Bitwise ops operate on signed 32-bit integers, so the high byte of each
    // dword (packet[5] and packet[9]) can set the sign bit.  Use >>>0 to coerce
    // back to unsigned before the 64-bit reconstruction.  Without this, the
    // timestamp goes negative when the low 32 bits exceed 2^31 (~35.8 min).
    const lo =
        (packet[2] | (packet[3] << 8) | (packet[4] << 16) | (packet[5] << 24)) >>> 0;
    const hi =
        (packet[6] | (packet[7] << 8) | (packet[8] << 16) | (packet[9] << 24)) >>> 0;
    const timestampUs = lo + hi * 0x1_0000_0000;

    const dataCount = packet[10];
    const samples: Sample[] = [];

    let offset = FIXED_BYTES;
    for (let i = 0; i < dataCount; i++) {
        if (offset + SAMPLE_BYTES > packet.length) throw new Error("packet truncated while reading samples");

        const range = packet[offset];
        const volAdc = packet[offset + 1] | (packet[offset + 2] << 8);
        const curAdc = packet[offset + 3] | (packet[offset + 4] << 8);
        const refAdc = packet[offset + 5] | (packet[offset + 6] << 8);

        const volts = volAdc * VOLTS_PER_ADC_LSB;
        const amps = currentUa(curAdc, refAdc, range) / 1_000_000.0;

        samples.push({ range, volAdc, curAdc, refAdc, volts, amps });
        offset += SAMPLE_BYTES;
    }

    return { timestampUs, dataCount, samples };
}

// Streaming parser: accumulates arbitrary chunks, emits complete packets,
// retains the trailing partial packet across calls.
export class PacketParser {
    private buf: Uint8Array = new Uint8Array(0);

    // Append a chunk and return any complete packets now available.
    push(chunk: Uint8Array): DecodedPacket[] {
        this.buf = this.buf.length ? concat(this.buf, chunk) : chunk;
        const out: DecodedPacket[] = [];

        for (; ;) {
            const h = findHeader(this.buf);
            if (h < 0) {
                // No header. Keep at most the last byte (could be start of split header).
                if (this.buf.length > 1) this.buf = this.buf.subarray(this.buf.length - 1);
                break;
            }
            // Drop garbage before the header.
            if (h > 0) this.buf = this.buf.subarray(h);

            if (this.buf.length < FIXED_BYTES) break; // need ts + count
            const count = this.buf[10];
            const total = FIXED_BYTES + count * SAMPLE_BYTES;
            if (this.buf.length < total) break; // wait for full payload

            const packet = this.buf.subarray(0, total);
            try {
                out.push(decodePacket(packet));
            } catch {
                // Malformed packet (bad header that slipped through). Skip its 2 bytes
                // and rescan — matches python's "continue on ValueError" resilience.
                this.buf = this.buf.subarray(1);
                continue;
            }
            this.buf = this.buf.subarray(total); // retain remainder
        }

        return out;
    }

    reset(): void {
        this.buf = new Uint8Array(0);
    }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}

// Returns index of 0xAA 0x55, or -1.
function findHeader(buf: Uint8Array): number {
    for (let i = 0; i + 1 < buf.length; i++) {
        if (buf[i] === 0xaa && buf[i + 1] === 0x55) return i;
    }
    return -1;
}
