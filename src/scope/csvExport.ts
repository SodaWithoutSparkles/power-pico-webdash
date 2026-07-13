import type { ScopeEngine } from "./ScopeEngine";

export function exportRegionCSV(
    engine: ScopeEngine,
    tStartUs: number,
    tEndUs: number,
    vZeroOffsetV: number,
    iZeroOffsetA: number,
): void {
    const snap = engine.snapshot();
    const lo = Math.min(tStartUs, tEndUs);
    const hi = Math.max(tStartUs, tEndUs);

    // Build CSV rows
    const rows: string[] = [];

    // Header comment with zero offsets
    rows.push(`# Zero offsets: V=${vZeroOffsetV.toFixed(6)}, I=${iZeroOffsetA.toFixed(6)}`);
    rows.push(`# Time range: ${lo} - ${hi} us (display time from T+0)`);

    // Column headers
    rows.push("timestamp_us,voltage_V,current_A,power_W");

    // Data rows (only points within the region)
    for (let k = 0; k < snap.t.length; k++) {
        const t = snap.t[k];
        if (t < lo || t > hi) continue;
        rows.push(`${t},${snap.v[k]},${snap.i[k]},${snap.w[k]}`);
    }

    // Generate timestamped filename
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const filename = `scope_export_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.csv`;

    // Trigger download
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
