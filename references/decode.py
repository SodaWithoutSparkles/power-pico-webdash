#!/usr/bin/env python3
"""
Reference decode implementation for the Power Pico Power Monitor protocol. 

This script connects to a serial port, 
reads packets from the device, decodes them, 
and computes rolling averages of voltage, current, and power.
"""

import collections
import struct
import sys
import time
from dataclasses import dataclass
from typing import Deque, List, Optional
import serial

# --- Configuration ---
COM_PORT = "COM15"
BAUD_RATE = 115200  # Adjust to match your firmware configuration
TIMEOUT_SEC = 1.0

# --- Protocol Constants & Scaling ---
PACKET_HEADER = b"\xAA\x55"

LOW_CUR = 1
MID_CUR = 2
HIGH_CUR = 3

SCALE_LOW_UA_PER_LSB = 3.0 / 4096.0 / 50.0 / 50.0 * 1_000_000.0
SCALE_MID_UA_PER_LSB = 3.0 / 4096.0 / 50.0 / 0.5 * 1_000_000.0
SCALE_HIGH_UA_PER_LSB = 3.0 / 4096.0 / 50.0 / 0.005 * 1_000_000.0

VOLTS_PER_ADC_LSB = (3000.0 / 4095.0) * 11.0 / 1000.0

"""
Format (max 711 bytes / 100 samples per packet; typical firmware packet = 10 samples = 81 bytes):
- Header: 2 bytes (0xAA55)
- Timestamp: 8 bytes (little-endian uint64)
- Data Count: 1 byte (uint8); <= 100 samples per packet
- Samples: N * <sample>, where N = Data Count

Sample format (7 bytes each):
- Range: 1 byte (uint8)
- Voltage ADC: 2 bytes (little-endian uint16)
- Current ADC: 2 bytes (little-endian uint16)
- Reference ADC: 2 bytes (little-endian uint16)
"""


@dataclass
class Sample:
    range: int
    vol_adc: int
    cur_adc: int
    ref_adc: int
    volts: float
    amps: float


@dataclass
class DecodedPacket:
    timestamp_us: int
    data_count: int
    samples: List[Sample]


def _current_ua(cur_adc: int, ref_adc: int, rng: int) -> float:
    delta = float(cur_adc - ref_adc)
    if rng == LOW_CUR:
        scale = SCALE_LOW_UA_PER_LSB
    elif rng == MID_CUR:
        scale = SCALE_MID_UA_PER_LSB
    elif rng == HIGH_CUR:
        scale = SCALE_HIGH_UA_PER_LSB
    else:
        raise ValueError(f"invalid range value: {rng}")
    return delta * scale


def decode_power_pico_packet(packet: bytes) -> DecodedPacket:
    if len(packet) < 11:
        raise ValueError("packet too short")

    if packet[:2] != PACKET_HEADER:
        raise ValueError("bad packet header")

    timestamp_us = struct.unpack_from("<Q", packet, 2)[0]
    data_count = packet[10]

    offset = 11
    samples: List[Sample] = []

    for _ in range(data_count):
        if offset + 7 > len(packet):
            raise ValueError("packet truncated while reading samples")

        rng = packet[offset]
        vol_adc, cur_adc, ref_adc = struct.unpack_from(
            "<HHH", packet, offset + 1
        )
        volts = vol_adc * VOLTS_PER_ADC_LSB
        amps = _current_ua(cur_adc, ref_adc, rng) / 1_000_000.0

        samples.append(
            Sample(
                range=rng,
                vol_adc=vol_adc,
                cur_adc=cur_adc,
                ref_adc=ref_adc,
                volts=volts,
                amps=amps,
            )
        )
        offset += 7

    return DecodedPacket(
        timestamp_us=timestamp_us,
        data_count=data_count,
        samples=samples,
    )


def read_exact(ser: serial.Serial, num_bytes: int) -> Optional[bytes]:
    """Helper to ensure we get the exact block of bytes requested."""
    data = b""
    while len(data) < num_bytes:
        chunk = ser.read(num_bytes - len(data))
        if not chunk:
            return None  # Read timeout occurred
        data += chunk
    return data


def sync_and_read_packet(ser: serial.Serial) -> Optional[bytes]:
    """Scans the stream for the 0xAA55 header and extracts a full packet."""
    while True:
        # Seek first byte of the header
        b1 = ser.read(1)
        if not b1:
            return None

        if b1 == b"\xAA":
            # Verify second byte of the header
            b2 = ser.read(1)
            if not b2:
                return None
            if b2 == b"\x55":
                break  # Synchronized successfully

    # Read timestamp (8 bytes) + data_count (1 byte)
    fixed_header = read_exact(ser, 9)
    if not fixed_header:
        return None

    data_count = fixed_header[8]
    payload_len = data_count * 7

    # Read all remaining sample data for this packet
    payload = read_exact(ser, payload_len)
    if payload is None:
        return None

    return PACKET_HEADER + fixed_header + payload


def main():
    print(f"Connecting to {COM_PORT}...")
    try:
        ser = serial.Serial(COM_PORT, baudrate=BAUD_RATE, timeout=TIMEOUT_SEC)
    except serial.SerialException as e:
        print(f"Error opening serial port {COM_PORT}: {e}", file=sys.stderr)
        return

    print(f"Connected to {COM_PORT}. Listening for packets...")

    # Rolling window tracking the last 5 valid packets
    packet_history: Deque[DecodedPacket] = collections.deque(maxlen=20)

    try:
        while True:
            packet_bytes = sync_and_read_packet(ser)
            if not packet_bytes:
                continue

            try:
                decoded = decode_power_pico_packet(packet_bytes)
                packet_history.append(decoded)

                # Compute the rolling average across all samples within the last 5 packets
                total_volts = 0.0
                total_amps = 0.0
                total_samples = 0

                for pkt in packet_history:
                    for sample in pkt.samples:
                        total_volts += sample.volts
                        total_amps += sample.amps
                        total_samples += 1

                if total_samples > 0:
                    avg_volts = total_volts / total_samples
                    avg_amps = total_amps / total_samples
                    avg_watts = avg_volts * avg_amps

                    # Display metrics
                    print(
                        f"[Window: {len(packet_history)} pkts / {total_samples} smpls] "
                        f"TS: {decoded.timestamp_us:<14} | "
                        f"Avg Volts: {avg_volts:6.3f} V | "
                        f"Avg Amps: {avg_amps:8.6f} A | "
                        f"Avg Power: {avg_watts:8.4f} W",
                        end="\r",
                        flush=True,
                    )

            except ValueError as e:
                # Handle structural errors gracefully without stopping execution
                print(f"\n[Parsing Error]: {e}", file=sys.stderr)

    except KeyboardInterrupt:
        print("\nStopping acquisition loop...")
    finally:
        ser.close()
        print("Serial port closed.")


if __name__ == "__main__":
    main()
