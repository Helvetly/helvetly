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
