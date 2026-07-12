# Pending issues (consolidated spec)

This document is the single source of truth for the next feature phase. It was
rewritten to remove internal conflicts found in the original wishlist. Read the
**Concepts** section first — several terms ("auto range", "zero", "window") were
used ambiguously before and now have precise meanings.

---

## Concepts (definitions — read before implementing)

### Two distinct "auto range" ideas (do NOT conflate)
1. **Unit auto-range** — *what unit label + precision* a series is shown in
   (V vs mV vs uV, etc.). This is a per-series *display* setting. See
   "Unit auto-range" below.
2. **Graph-level Y auto-range** — *what numeric window* the Y axis spans so the
   trace fits. This is a per-series *axis* behavior with hysteresis. See
   "Graph Y-axis" below.

These are independent. A series can be in `meter` unit mode while its graph Y
axis is manually fixed, for example.

### Data model change (prerequisite for meter mode)
The firmware reports a current **range** (LOW/MID/HIGH) per sample, but today
`AveragingBuffer.average()` discards it and `DisplayPoint` has no range field.
We must carry the range through:
- Add `range: number` to `DisplayPoint` (and to the averaged point).
- **Winner rule:** when an averaging window spans a range switch, the *latest*
  switched value wins (the meter's internal logic wanted to switch, so the most
  recent decision is authoritative). Voltage has no range switch in firmware,
  so `range` is only meaningful for current.
- This `range` is used only for the **meter** unit mode label + UI display; it
  does NOT change the stored value (amps stay in A).

### Software zero (applied at ingestion)
- A per-series offset (`vZeroOffsetV`, `iZeroOffsetA`) is subtracted from the
  raw value **at ingestion**, so every consumer (display, region stats, wattage,
  detectors) sees zeroed data automatically. No consumer re-applies it.
- Exception: during the **calibration window** the offset is held at 0 so the
  noise can be measured, then the averaged noise is written as the offset.
- Calibration: a "Calibrate meter" action runs for a configurable
  **calibration time**, averages the noise, and stores it as the offset. V and A
  are calibrated independently, OR the user may key in a value manually.
    - IF keyed in manually, an "advanced" option allows user to set offset *per range* (LOW/MID/HIGH) for current. This is a niche use case for advanced users, as average users would not have a precise load to calibrate against.
- Micro-level noise during auto-range switches is acceptable and ignored.

### X-axis time base
- Config: `pktPerSec` (default 1000, known at meter compile time) and
  `bufferSec`. Derived: `bufferSize = round(pktPerSec * bufferSec)`.
- The **actual** X values obey the meter's reported timestamps, not the nominal
  rate. `pktPerSec` is a *config* value; the *measured* pkt/s stays in the status
  bar (minified, e.g. `999 pkt/s`) purely for link-health monitoring.
- **T+0** = the software timestamp captured at each start/reset; X axis is shown
  relative to it.

### Energy unit camp
- User picks a camp once: **Joules** or **Wh**. Within the chosen camp the value
  auto-ranges (J / kJ, or Wh / mWh / kWh). No mixing.

---

## 1. Unit auto-range (per series)
Currently measurements are hard-coded to 3dp in V/A/W (`Measurements.tsx`).
Add a configurable per-series unit mode with 3dp precision and hysteresis (to
avoid flapping):
- **Off**: fixed unit chosen by user — `[uV|mV|V]`, `[uA|mA|A]`,
  `[uW|mW|W]`. Would cause nonsense values (e.g. 0.000123 V) if the user picks a unit that doesn't match the data.
- **SI**: auto-range to SI units (V/mV/uV, A/mA/uA, W/mW/uW) with hysteresis.
- **meter**: *current series only.* Follow the meter's reported range
  (LOW/MID/HIGH) and display in the matching unit (uA/mA/A). Show the meter's
  current range in the UI. **V and W do not get a `meter` mode** — they fall back
  to SI. (Voltage uses a fixed divider in firmware; there is no range switch.)

Modes are per series and changeable at any time.

## 2. Graph Y-axis (per series, decoupled)
Replace the single `vScale` with a per-series scale object. V and A (and W) each
get their own Y axis by default. **The Y axis always has units** — a bare "1"
is meaningless without knowing it is uA / mA / A (etc.).
- **Graph-level auto-range**: fit all visible data, with hysteresis for smooth
  (not jumpy) transitions. The auto window **follows the series' unit range**
  (see §1): e.g. if the current series is in `mA` unit mode, the auto Y axis
  spans mA and its tick labels read `mA`. The numeric bounds are derived in that
  unit, not raw A.
- **Manual override**: wheel zoom or keyed-in min/max. The fixed range **carries
  a unit too** — e.g. "fixed from 0 mA to 500 mA". When manual, show a "reset"
  button to return to auto-range; the min/max fields gray out (still display the
  live auto values) while auto is active. The unit shown is the series' current
  unit (from §1); switching unit mode re-expresses the fixed bounds in the new
  unit.
- **Per-series Y zoom**: wheel zoom on a series' axis zooms that series only
  (bounds stay expressed in the series' unit).
- **Out-of-range notification**: if data falls outside the visible Y window
  (manual or auto), raise **one** "out of range" notification per series and
  keep it (do not spam — at most one such notification at a time; clear it when
  the data returns in range). Never stack 10 identical warnings.
- **Link scales**: dropped for this phase (low value). Revisit later.

## 3. Software zero / meter calibration
As defined in Concepts. UI: a "Calibrate" action (per V and per A, or manual
key-in) with configurable calibration time. Offset applied at ingestion.

## 4. Selection-based region stats
On graph drag-select, show (with software zero already applied at ingestion):
- **T+start to T+end** and **time elapsed** (mimic official app's
  "T+12 to T+15" + "time elapsed 3s" — supports cross-region delta-t).
- Avg / Min / Max per series (V/A/W).
- Total energy, auto-ranged within the chosen energy camp.
(Region selection also feeds CSV export — see §6.)

## 5. Zoom & scroll UX
- **Wheel zoom**: centered on newest data when running, on cursor when paused.
  Modifier key (Shift) zooms faster. X and Y zoom independently (Y per series).
- **X clamp**: cannot zoom out beyond `bufferSec`.
- **Zoomed preview**: when zoomed in, a scrollable preview appears bottom-right
  showing the view window; drag to scroll, click to jump. Double-click → reset
  to full buffer (auto-range).
- **Scrollbar**: appears at graph bottom when **paused AND not at full buffer**;
  hidden while running or when fully zoomed out. Draggable, shows view window.

## 6. CSV export
Export time, voltage, current, power (zeroed). Include the current zero offset
in a header comment/column. Timestamped filename, header row. Reuse the active
drag-selection as the export time range (no second range picker).

## 7. Graph enhancements
### 7a. Visual window band (render-only averaging)
Drop `avg-k` entirely (it was a perf hack; browser handles k=1 fine, and
pre-averaging would hide real events like a 2 ms power interrupt). Instead, as a
**render** feature, divide the visible window into small time buckets; compute
max/min/avg per bucket; draw avg as a brighter line and min/max as a dimmer
band. No ingestion change — raw samples are preserved for debugging.
### 7b. Wattage series off by default
W disabled by default; user can enable. Computed as `w = v * (i - iZeroOffsetA)`
so it obeys software zero. Shown in the same unit family as V/A (W/mW/uW).

## 8. Unified detector (peak + threshold)
A single detector subsystem covers both, opened as a **popup panel at the same
level as Settings** (new reusable `PopupPanel` component, fixed size ~0.75 ×
0.9 viewport — fix the current settings window's content-dependent sizing).
- Config per series (V/A): threshold, hysteresis, debounce, direction
  (positive/negative/both), enable/disable.
- Real-time; markers drawn on the graph.
- Events feed `NotificationCenter`; optional **audio alert** (Web Audio, unlocked
  on the connect/start user gesture).
- A list view of detected events with timestamps; exportable as CSV.
- Peak and threshold share one algorithm/config shape to avoid two parallel
  implementations.

## 9. UI consolidation
- Add a **"Range operations"** button top-right consolidating infrequent actions
  (export, detailed summary, detector open, calibration).
- **Remove** the Simulate button; **move Clear** to the left toolbar.
- **Reuse the top bar** as a small, user-configurable summary (let the user pick
  which readouts appear). The measured `pkt/s` lives here minified for link
  health.

## 10. Persistent log storage
Sometimes we want to keep a record on disk for a long time (and survive a
browser crash). Add a **persistent storage** option in settings.

### Settings
- **Persistent storage on/off** — master toggle.
- **Sample window** — save 1 sample from a **X packets** average (sub-text shows the
  equivalent per-second rate, derived from `pktPerSec`).
- **Sample time unit** — `sec` / `min` / `hour` (granularity label for the log).
- **Expected storage size** — displayed live, computed from the packet byte
  size (typical 81 B = 11 B header + 10×7 B samples; protocol max 711 B =
  100 samples) × expected packets received (so the user can judge disk use
  before enabling).
- **Compression interval** — `0` = off; any other value = seconds between
  compression passes.

### Backend
- **OPFS only** for now (single supported backend).
- Future might add disk storage but need user confirmation -> extra step.

### Write path
- Logs are written to a **WAL per second**.
- If compression is enabled, a second **compressed file store** is written **per  minute**. (Exact on-disk format is out of scope for now — define later.)

### Actions & status
- Buttons: **"Export log"** and **"Clear log"** (live in the Range operations
  menu / settings).
- Status bar shows **"log enabled"** when persistent storage is active.
- On start, if we found a log, ask user if they want to **resume** or **clear** it. If resuming, the log is read and the graph is populated with the last `bufferSec` of data. 

---

## Implementation order (dependencies)
1. **Data model + ingestion**: carry `range` through `DisplayPoint`; add
   per-series software zero at ingestion; config `pktPerSec`/`bufferSec`;
   energy camp setting. (Unblocks everything else.)
2. Per-series unit auto-range + graph Y-axis (§1, §2) + software zero UI (§3).
3. Zoom/scroll UX (§5).
4. Region stats (§4) + CSV export (§6).
5. Unified detector (§8) + UI consolidation (§9).
6. Visual window band (§7a) + W-off-by-default (§7b).
7. Persistent log storage (§10) — depends on §1 data model + X-axis time base
   (`pktPerSec` for the per-second WAL rate and expected-size math).