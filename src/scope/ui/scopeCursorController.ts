/** Pure functions for mapping readCursor ↔ green-rect position in the ZoomPreview. */

const MIN_GREEN_WIDTH = 8;

/**
 * Pixel width of the green viewport rect.
 * The visible window covers `bucketCount * avgWindowSize` raw samples out of
 * `rawRingCapacity` total.  The green rect shows that proportion.
 */
export function computeGreenWidth(
    bucketCount: number,
    avgWindowSize: number,
    rawRingCapacity: number,
    blackWidth: number,
): number {
    const covered = bucketCount * avgWindowSize;
    const ratio = rawRingCapacity > 0 ? covered / rawRingCapacity : 0;
    return Math.max(MIN_GREEN_WIDTH, Math.round(ratio * blackWidth));
}

/** Map cursor fraction [0,1] → left pixel position of the green rect. */
export function cursorToLeft(
    cursor: number,
    blackWidth: number,
    greenWidth: number,
): number {
    const maxLeft = blackWidth - greenWidth;
    if (maxLeft <= 0) return 0;
    return Math.max(0, Math.min(maxLeft, Math.round(cursor * maxLeft)));
}

/** Map a left pixel position → cursor fraction [0,1]. */
export function leftToCursor(
    left: number,
    blackWidth: number,
    greenWidth: number,
): number {
    const maxLeft = blackWidth - greenWidth;
    if (maxLeft <= 0) return 1;
    return Math.max(0, Math.min(1, left / maxLeft));
}
