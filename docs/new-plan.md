# System Architecture & Handoff Implementation Plan

This document outlines the complete implementation plan for a high-performance, Web Serial-based web monitor. It is designed for a developer to implement the frontend and Web Worker infrastructure required to ingest, process, and render a $10\text{k}$ samples/second telemetry stream from an STM32-based power meter.

---

## 1. System Topology & Threading Model

To ensure a lock-free 60 FPS UI, the application is divided into two distinct execution contexts: the **Main Thread (UI Context)** and a **Web Worker (Ingest & Computation Context)**.

```
[STM32 Hardware] 
       │ (USB CDC @ ~81 KB/s)
       ▼
 ┌────────────────────────────────────────────────────────┐
 │                   WEB WORKER THREAD                    │
 │                                                        │
 │  ┌────────────────┐      ┌─────────────┐               │
 │  │  Stream Parser │ ───> │   Decoder   │               │
 │  └────────────────┘      └─────────────┘               │
 │                                 │                      │
 │                                 ▼                      │
 │                         ┌─────────────┐                │
 │                         │ Ring Buffer │                │
 │                         └─────────────┘                │
 │                                 │                      │
 │                                 ▼                      │
 │                      ┌─────────────────────┐           │
 │                      │ Format Engine       │  ──────┐  │
 │                      │ (Downsampling/Math) │        │  │
 │                      └─────────────────────┘        │  │
 └─────────────────────────────────────────────────────┼──┘
                                                       │ (PostMessage / 
                                                       │  Transferables)
 ┌─────────────────────────────────────────────────────┼──┐
 │                     MAIN THREAD                     │  │
 │                                                     │  │
 │  ┌────────────────┐      ┌─────────────────────┐    │  │
 │  │   UI Engine    │ <─── │ UI Layout & Scale   │ <──┘  │
 │  │ (Canvas/WebGL) │      │ (Hysteresis Filter) │       │
 │  └────────────────┘      └─────────────────────┘       │
 └────────────────────────────────────────────────────────┘

```

---

## 2. Ingest Engine & Decoder (Worker Thread)

The Ingest Engine manages Web Serial streaming and handles stream alignment.

### Stream Parser

Web Serial delivers arbitrary chunk sizes. The incoming stream must be framed using a sliding-window buffer to align on the `0xAA55` header.

* **State Machine:**
1. Search stream for `0xAA` followed by `0x55`.
2. Read the next 9 bytes (8B timestamp, 1B Data Count $N$).
3. Validate payload size: Expected bytes $= N \times 7$.
4. If the incoming chunk terminates mid-packet, buffer the trailing bytes and await the next chunk.
5. Once verified, pass the slice to the Decoder.



### Decoder

The Decoder normalizes the raw ADC values using the hardware scale multipliers immediately to avoid dealing with mixed scales inside the memory buffer.

```
Low Range (0 - 500uA)    => Current = ADC * Multiplier_Low
Mid Range (500uA - 50mA)  => Current = ADC * Multiplier_Mid
High Range (50mA - 5A)   => Current = ADC * Multiplier_High

```

---

## 3. Storage Layer: Ring Buffer (Worker Thread)

To optimize memory usage and cache locality, the Ring Buffer utilizes a **Structure of Arrays (SoA)** design rather than an Array of Objects.

### Storage Layout

```javascript
class TelemetryRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.head = 0; // Insertion index
    this.tail = 0; // Oldest data index
    this.isFull = false;

    // Allocated in worker memory space
    this.timestamps = new BigInt64Array(capacity); // Raw timestamp in microseconds/nanoseconds
    this.voltages = new Float32Array(capacity);     // Normalized Volts (V)
    this.currents = new Float32Array(capacity);     // Normalized Amperes (A)
  }
}

```

* **Capacity Guide:** At $10,000\text{ samples/sec}$, a $10\text{-minute}$ history window requires $6\text{ million}$ slots.
* Memory footprint: $6\text{M} \times (8\text{B} + 4\text{B} + 4\text{B}) \approx 96\text{ MB}$.
* This fits easily within standard browser memory allocations.



---

## 4. Communication & Calculation API

The worker thread exposes three main processing routines to the main thread. All returned array data must use **Transferable Objects** (transferring the underlying `ArrayBuffer` back to the main thread) to avoid serialization copying costs.

### `getDataSince`

Used for live scrolling updates. Returns bucketed data starting from a specific timestamp up to the latest head.

```typescript
function getDataSince(
  sinceTs: bigint, 
  bucketCount: number
): { 
  avgV: Float32Array; maxV: Float32Array; minV: Float32Array;
  avgI: Float32Array; maxI: Float32Array; minI: Float32Array;
  timestamps: BigInt64Array;
}

```

### `getDataWindow`

Used for historical analysis, zooming, and panning.

```typescript
function getDataWindow(
  fromFraction: number, // 0.0 (oldest) to 1.0 (newest)
  toFraction: number, 
  bucketCount: number
): BucketedTelemetryData

```

### `getFracByTS`

Locates a target timestamp relative to the overall buffer bounds. Used to draw viewport indicator positions on a slider or "minimap".

```typescript
function getFracByTS(targetTs: bigint): number // Returns float [0.0, 1.0]

```

### Bucketing Algorithm: Min-Max Downsampling

To prevent high-frequency current spikes from disappearing when zoomed out, the Format Engine must utilize **Min-Max / Peak-Detect bucketing** instead of simple averaging.

For each bucket interval:

1. Locate the slice of raw elements falling within the bucket's time slice.
2. Find the minimum, maximum, and average values in that slice.
3. Store these into the output bucket arrays. This allows the UI to draw a transparent standard-deviation/envelope band (Min-to-Max fill) behind a solid line (Average).

---

## 5. UI Layout & Dynamic Scaling (Main Thread)

The Main Thread handles visual rendering and UI state transitions based on the data processed by the worker.

### Graph Rendering Engine

* Use **HTML5 Canvas 2D Context** or a lightweight WebGL graphing wrapper.
* Render the graph on a dedicated requestAnimationFrame loop.

### Display Scale Hysteresis (Schmitt Trigger)

To prevent the Y-axis scale and unit readouts from flickering when current consumption hovers near boundary regions (e.g., oscillating between $450\mu\text{A}$ and $600\mu\text{A}$), implement a unit-scaling state machine with a cool-down timer.

| Current Visual Scale | Jump Up Trigger | Jump Down Trigger |
| --- | --- | --- |
| **Microamperes ($\mu\text{A}$)** | Peak value exceeds $500\mu\text{A}$ | *N/A* |
| **Milliamperes ($\text{mA}$)** | Peak value exceeds $1000\text{mA}$ | Peak value drops below $400\mu\text{A}$ |
| **Amperes ($\text{A}$)** | *N/A* | Peak value drops below $0.8\text{A}$ |

#### Cooler-Timer Execution Logic

```
                  ┌────────────────────────┐
                  │   Sample Peak > Up?    │ ───Yes───> [Switch Unit Instantly]
                  └────────────────────────┘
                              │
                             No
                              ▼
                  ┌────────────────────────┐
                  │   Sample Peak < Down?  │ ───No────> [Reset Timer; Retain Scale]
                  └────────────────────────┘
                              │
                             Yes
                              ▼
                  ┌────────────────────────┐
                  │ Has timer expired?     │ ───Yes───> [Downscale Unit]
                  │ (e.g., 1500ms cool)   │
                  └────────────────────────┘
                              │
                             No
                              ▼
                     [Retain Current Scale]

```

---

## 6. Integration Mathematics (Worker Thread)

Because the UI only receives bucketed display arrays, the worker must handle all numerical integration directly against the raw, un-bucketed Ring Buffer arrays to prevent calculation drift.

### Session Accumulator (Dual-Stage Mitigation)

To calculate total Energy (Watt-hours) and total Charge (Coulombs) without accumulating floating-point round-off errors over hours of logging:

1. Keep a high-resolution, small-scale accumulator for micro-changes.
2. Once the micro-accumulator exceeds $1.0\text{ Coulomb}$ or $1.0\text{ Joule}$, flush the integer portion to the global session registers.

$$\Delta t_k = \frac{\text{timestamp}_k - \text{timestamp}_{k-1}}{1,000,000,000} \quad (\text{seconds})$$

$$dQ = I_k \times \Delta t_k \quad (\text{Coulombs})$$

$$dE = V_k \times I_k \times \Delta t_k \quad (\text{Joules})$$

### Selection Bound Integration

When a user highlights a region on the screen:

1. Send target timestamps `t_start` and `t_end` to the worker.
2. The worker uses binary search to find the closest indices inside the Ring Buffer.
3. Run a tight, sequential loop over the un-bucketed slice:

$$Q_{\text{selected}} = \sum_{k=\text{start}}^{\text{end}} I_k \times \Delta t_k$$

$$E_{\text{selected}} = \sum_{k=\text{start}}^{\text{end}} V_k \times I_k \times \Delta t_k$$

4. Convert Joules to Watt-hours ($Wh = \text{Joules} / 3600$) and send the payload back to the main thread for displaying in the selection tooltip.

---

## 7. Phased Implementation Roadmap

### Phase 1: Raw Packet Ingest & Parser Validation

* **Goal:** Establish Web Serial communication and verify packet alignment in the worker thread.
* **Success Metric:** Run the worker for 5 minutes without losing sync or missing the `0xAA55` frame headers. Print data metrics to console.

### Phase 2: Ring Buffer & Downsampling

* **Goal:** Implement the Structure of Arrays Ring Buffer and the Min-Max bucketing algorithm.
* **Success Metric:** Trigger `getDataWindow` requests and verify that downsampled arrays preserve transient spike amplitudes correctly.

### Phase 3: Canvas Graph & Hysteresis UI

* **Goal:** Wire up the UI loop to draw the voltage/current streams using Canvas. Implement the scale-switching hysteresis.
* **Success Metric:** Graph updates smoothly at 60 FPS without layout jitter when simulating rapid current transitions near boundary zones.

### Phase 4: Integration Math & Diagnostics

* **Goal:** Build the dual-stage accumulators and selection math inside the worker.
* **Success Metric:** Run integration calculations on selection regions and verify that results accurately match known constant load profiles.