# Phase 0 + 1 Handoff — Deps, Types, Decode

Status: **DONE**. Tests green (10/10).

## What shipped

### Phase 0 — Deps & types
- `package.json`: added `"uplot": "^1.6.32"` to dependencies. (Run `npm install` to pull it; not yet imported — Phase 4 will use it.)
- `src/types/web-serial.d.ts`: minimal ambient `SerialPort` / `Serial` / `navigator.serial` declarations. Only the surface the engine needs (open, close, readable, requestPort, getPorts, getInfo). Feature-detect via `'serial' in navigator` — no vendor checks.
  - ponytail: avoided `@types/w3c-web-serial` dep; TS 5.9 lib.dom still lacks these.

### Phase 1 — Decode (`src/scope/decode.ts`)
Pure, DOM-free. Math ported 1:1 from `references/decode.py`.

Exports:
- Constants: `HEADER = 0xAA55`, `LOW_CUR/MID_CUR/HIGH_CUR`, `SCALE_*_UA_PER_LSB`, `VOLTS_PER_ADC_LSB`, byte-size consts (`FIXED_BYTES=11`, `SAMPLE_BYTES=7`).
- `decodePacket(packet: Uint8Array): DecodedPacket` — `{ timestampUs, dataCount, samples[] }`. Each sample `{ range, volAdc, curAdc, refAdc, volts, amps }`.
- `PacketParser` class — streaming accumulator. `push(chunk)` returns complete `DecodedPacket[]`, retains trailing partial across calls. Handles: split-across-chunks, multiple packets per chunk, garbage before header, and resync after a malformed header (drops 1 byte, rescans).

Key math (matches decode.py exactly):
- `volts = volAdc * VOLTS_PER_ADC_LSB`
- `amps = (curAdc - refAdc) * SCALE_<range>_UA_PER_LSB / 1e6`
- Timestamp: little-endian uint64 → `lo + hi * 0x1_0000_0000` (Number; safe, wraps at ~585k yr).

### Tests (`src/scope/decode.test.ts`)
Zero-dep, `node --test --experimental-strip-types`. 10 cases: volts/amps math, per-range scales, multi-sample, bad-header/short rejection, parser reassembly (split chunks), multi-packet + trailing partial, garbage skip, malformed-header resync, HEADER sanity.

Run: `node --test --experimental-strip-types src/scope/decode.test.ts`

## Decisions / notes
- Timestamp uses `Number`, not `BigInt`, for display math. Engine (Phase 2) stores `tZeroOffsetUs` as `number` too — consistent. If sub-μs precision or >2^53 μs ever matters, revisit; not now.
- `PacketParser` keeps at most 1 trailing byte when no header found (could be split header start). Resync on throw drops 1 byte — mirrors python's `continue` on `ValueError`.

## Next (Phase 2 — Engine)
- `src/scope/ScopeEngine.ts`: `connect()`, read loop → `PacketParser` → averaging buffer (FIFO `k`) → display ring (size `N`). `start/pause/clear/setConfig`, `onStatus`, simulate mode, read-only serial.
- Consumes `decodePacket` + `PacketParser` directly. No API changes needed here.
- T+0 offset + discontinuity guard live in the engine (Phase 3 store holds `tZeroOffsetUs`).

## Files touched
- `package.json` (dep added)
- `src/types/web-serial.d.ts` (new)
- `src/scope/decode.ts` (new)
- `src/scope/decode.test.ts` (new)
