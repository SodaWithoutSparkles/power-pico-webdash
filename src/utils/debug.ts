// Lightweight, maintainable debug logging for the scope engine + render loop.
//
// Enable (in priority order):
//   1. URL query param:  http://host/?debug
//   2. localStorage flag: localStorage.setItem("scope:debug", "1")
//   3. Dev builds automatically (import.meta.env.DEV)
//
// Usage:
//   import { createDebug, createDebugThrottled } from "../utils/debug";
//   const log = createDebug("engine");
//   log("started, mode=%s running=%s", mode, running);
//
// `createDebugThrottled` caps log volume for hot paths (e.g. the rAF loop or
// per-packet ingest) so the console isn't flooded.

function isEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try {
        if (new URLSearchParams(window.location.search).has("debug")) return true;
        if (localStorage.getItem("scope:debug") === "1") return true;
    } catch {
        /* ignore storage/URL access errors */
    }
    return import.meta.env.DEV;
}

const ENABLED = isEnabled();

const PREFIX = "%c[scope:%s]%c";
const PREFIX_STYLE = "color:#22d3ee;font-weight:bold";
const RESET_STYLE = "color:inherit";

export type DebugFn = (...args: unknown[]) => void;

// Logs every call (when enabled). Suitable for low-frequency events such as
// lifecycle transitions, button handlers, and chart construction.
export function createDebug(namespace: string): DebugFn {
    return (...args: unknown[]) => {
        if (!ENABLED) return;
        // eslint-disable-next-line no-console
        console.log(PREFIX, PREFIX_STYLE, namespace, RESET_STYLE, ...args);
    };
}

// Logs at most once per `intervalMs`. Suitable for hot paths (rAF loop,
// per-packet ingest) where every-call logging would be unreadable.
export function createDebugThrottled(namespace: string, intervalMs: number): DebugFn {
    let last = 0;
    return (...args: unknown[]) => {
        if (!ENABLED) return;
        const now = performance.now();
        if (now - last < intervalMs) return;
        last = now;
        // eslint-disable-next-line no-console
        console.log(PREFIX, PREFIX_STYLE, namespace, RESET_STYLE, ...args);
    };
}
