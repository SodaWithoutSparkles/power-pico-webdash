// Domain constants for the scope engine pipeline.
// Single source of truth — import instead of hardcoding magic numbers.

// ── Default engine sizing ──

/** Default sample interval between observations (µs). 100 µs = 10 kHz. */
export const DEFAULT_SAMPLE_INTERVAL_US = 100;

/** Default raw ring buffer capacity. */
export const DEFAULT_RING_CAPACITY = 1_000_000;

/** Default display ring capacity. */
export const DEFAULT_DISPLAY_CAPACITY = 10_000;

/** Default averaging window size (raw samples per display bucket). */
export const DEFAULT_AVG_WINDOW_SIZE = 10;

// ── Rate smoothing ──

/** Minimum interval (ms) between samples/s recomputation. */
export const RATE_SMOOTH_MS = 500;

// ── Render loop timing ──

/** Target interval (ms) between data refreshes (~30 fps). */
export const DATA_REFRESH_MS = 33;

/** Frames between session totals updates (~2 fps at 60 fps loop). */
export const SESSION_TOTALS_INTERVAL = 30;

/** Frames between debug log prints (~1 Hz at 60 fps). */
export const DEBUG_LOG_INTERVAL = 60;

// ── Stall detection ──

/** New samples per frame above this triggers a stall warning. */
export const STALL_WARN_THRESHOLD = 1000;

/** New samples per frame below this resets the stall warning. */
export const STALL_RESET_THRESHOLD = 100;

/** Initial bucket count for the display viewport. */
export const INITIAL_BUCKET_COUNT = 200;

// ── Chart / uPlot viewport ──

/** Minimum display bucket count. */
export const BUCKET_COUNT_MIN = 50;

/** Maximum display bucket count. */
export const BUCKET_COUNT_MAX = 4000;

/** Pixels per bucket coefficient (chartWidth × this = bucket count). */
export const BUCKET_PX_RATIO = 2;

/** Minimum drag width (px) to trigger integration selection. */
export const MIN_DRAG_WIDTH = 5;

// ── Serial connection ──

/** Default serial baud rate. */
export const SERIAL_BAUD_RATE = 115200;

/** Serial throughput logging interval (ms). */
export const SERIAL_LOG_INTERVAL_MS = 2000;

// ── Simulation worker ──

/** Simulator packet generation rate (Hz). */
export const SIM_PKT_RATE_HZ = 1000;

/** Simulator samples per packet. */
export const SIM_SAMPLES_PER_PACKET = 10;

/** Simulator sine wave frequency (Hz). */
export const SIM_FREQ_HZ = 0.5;

/** Simulator tick interval (ms). */
export const SIM_TICK_MS = 5;
