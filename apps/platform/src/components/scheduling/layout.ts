// Where blocks sit in a day column of the time grid: overlapping blocks share the width side by side.

export type Span = { id: string; start: number; end: number }
export type Placed = Span & { col: number; cols: number }

/**
 * Blocks that overlap (directly or through a chain) form a cluster; each block takes the first column free at its
 * start, and every block of a cluster is as wide as the cluster's column count. Touching ends do not overlap.
 */
export function layoutDay(spans: readonly Span[]): Placed[] {
  const sorted = spans.toSorted(
    (a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id),
  )
  const placed: Placed[] = []
  let cluster: Placed[] = []
  let columnEnds: number[] = []
  let clusterEnd = -Infinity
  const close = () => {
    for (const block of cluster) block.cols = columnEnds.length
    cluster = []
    columnEnds = []
  }
  for (const span of sorted) {
    if (span.start >= clusterEnd) close()
    let col = columnEnds.findIndex((end) => end <= span.start)
    if (col === -1) col = columnEnds.push(span.end) - 1
    else columnEnds[col] = span.end
    const block = { ...span, col, cols: 1 }
    cluster.push(block)
    placed.push(block)
    clusterEnd = cluster.length === 1 ? span.end : Math.max(clusterEnd, span.end)
  }
  close()
  return placed
}

/** A block's start and end in a day, clipped to it: minutes since midnight, a block running past midnight ends at 1440. */
export function clipToDay(
  startDate: string,
  startMinutes: number,
  endDate: string,
  endMinutes: number,
  day: string,
) {
  if (endDate < day || startDate > day) return null
  const start = startDate < day ? 0 : startMinutes
  const end = endDate > day ? 1440 : endMinutes
  return end > start ? { start, end } : null
}

/** A pointer offset in pixels as minutes, snapped to `snap`. */
export const snapMinutes = (pixels: number, hourHeight: number, snap = 15) =>
  Math.round(((pixels / hourHeight) * 60) / snap) * snap
