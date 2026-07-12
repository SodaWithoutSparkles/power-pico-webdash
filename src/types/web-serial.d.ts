// Minimal ambient declarations for the Web Serial API.
// Only the surface the scope engine needs. Feature-detect via `'serial' in navigator`.
// ponytail: lib.dom in TS 5.9 still lacks these; keep tiny, no full @types/w3c-web-serial dep.

interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
}

interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
}

interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    readonly readableEnded: boolean;
    readonly writableEnded: boolean;
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    getInfo(): SerialPortInfo;
}

interface SerialPortRequestOptions {
    filters?: SerialPortInfo[];
}

interface Serial extends EventTarget {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
    readonly serial: Serial;
}
