export type DashboardLayout = { order: string[]; hidden: string[] }

export function dashboardLayoutKey(workspaceId: string, userId: string) {
  return `helvetly.dashboard.layout:${JSON.stringify([workspaceId, userId])}`
}

export function mergeDashboardLayout(
  defaultOrder: readonly string[],
  stored: unknown,
): DashboardLayout {
  const knownIds = new Set(defaultOrder)
  const known = (value: unknown) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id: unknown): id is string => typeof id === 'string' && knownIds.has(id)),
          ),
        ]
      : []
  const saved = stored && typeof stored === 'object' ? stored : {}
  const order = known('order' in saved ? saved.order : undefined)
  for (const [index, id] of defaultOrder.entries()) {
    if (!order.includes(id)) order.splice(index, 0, id)
  }
  return { order, hidden: known('hidden' in saved ? saved.hidden : undefined) }
}

export function loadDashboardLayout(key: string, defaultOrder: readonly string[]): DashboardLayout {
  try {
    return mergeDashboardLayout(
      defaultOrder,
      JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    )
  } catch {
    return mergeDashboardLayout(defaultOrder, null)
  }
}

export function saveDashboardLayout(key: string, layout: DashboardLayout | null) {
  try {
    if (layout) window.localStorage.setItem(key, JSON.stringify(layout))
    else window.localStorage.removeItem(key)
  } catch {
    // The layout still applies for the current page when storage is unavailable.
  }
}

export function moveDashboardCard(order: string[], id: string, target: string): string[] {
  const from = order.indexOf(id)
  const to = order.indexOf(target)
  if (from === -1 || to === -1 || from === to) return order
  const next = order.filter((card) => card !== id)
  next.splice(to, 0, id)
  return next
}

/**
 * Whether a dragged card over `target` should take its place: once the pointer is past the target's
 * middle in the direction the card moves (across in the same row, down or up between rows), so a
 * card that has just made room does not swap straight back.
 */
export function passesMiddle(
  target: { left: number; top: number; width: number; height: number },
  pointer: { x: number; y: number },
  forward: boolean,
  sameRow: boolean,
) {
  const along = sameRow
    ? pointer.x - (target.left + target.width / 2)
    : pointer.y - (target.top + target.height / 2)
  return forward ? along > 0 : along < 0
}

/** How much of a 12-column row a card takes: its preferred share, never less than its minimum. */
export type CardSpan = { min: number; preferred: number }
export const DASHBOARD_COLUMNS = 12

/**
 * Lays cards out in rows, in order: a card joins the row while every card in it still gets its
 * minimum, else it starts the next. Each row is then filled exactly: over-full rows give back down to
 * the minimums, the widest first; room left over is shared evenly (the last card takes any rest), so a
 * row never has a gap or an odd narrow leftover.
 */
export function packDashboardRows<T extends CardSpan & { id: string }>(
  cards: readonly T[],
  columns = DASHBOARD_COLUMNS,
): { id: string; span: number }[][] {
  const rows: T[][] = []
  for (const card of cards) {
    const row = rows.at(-1)
    const used = row?.reduce((sum, other) => sum + other.min, 0) ?? columns
    if (row && used + card.min <= columns) row.push(card)
    else rows.push([card])
  }
  return rows.map((row) => {
    const spans = row.map((card) => Math.min(card.preferred, columns))
    let extra = spans.reduce((sum, span) => sum + span, 0) - columns
    while (extra > 0) {
      // Take one column from the widest card still above its minimum.
      let widest = -1
      for (const [i, card] of row.entries())
        if (spans[i]! > card.min && (widest === -1 || spans[i]! > spans[widest]!)) widest = i
      spans[widest]! -= 1
      extra -= 1
    }
    const share = Math.floor(-extra / row.length)
    const rest = -extra - share * row.length
    return row.map((card, i) => ({
      id: card.id,
      span: spans[i]! + share + (i === row.length - 1 ? rest : 0),
    }))
  })
}
