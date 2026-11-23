'use client'
import { minutesOf, type HostProfile } from '@/lib/scheduling'

/** The hours a day or week grid shows, as whole hours: from 0 to 24 is the full day. */
export type Hours = { from: number; to: number }
export type HoursChoice = { mode: 'full' | 'work'; work: Hours }

export const FULL_DAY: Hours = { from: 0, to: 24 }
export const HOURS_KEY = 'helvetly.scheduling.hours'

const isHours = (value: unknown): value is Hours => {
  if (typeof value !== 'object' || value === null) return false
  const { from, to } = value as Record<string, unknown>
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    Number(from) >= 0 &&
    Number(to) <= 24 &&
    Number(from) < Number(to)
  )
}

/** The host's working hours rounded out to whole hours, else 06:00–22:00. */
export function workingHours(profile: HostProfile | undefined): Hours {
  const weekly = profile?.weekly ?? []
  if (!weekly.length) return { from: 6, to: 22 }
  const from = Math.floor(Math.min(...weekly.map((entry) => minutesOf(entry.start))) / 60)
  const to = Math.ceil(Math.max(...weekly.map((entry) => minutesOf(entry.end))) / 60)
  return from < to ? { from, to: Math.min(24, to) } : { from: 6, to: 22 }
}

// A personal display preference kept per browser; storage may be unavailable or hold anything.
export function storedHours(): HoursChoice | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(HOURS_KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return null
    const { mode, work } = saved as Record<string, unknown>
    return (mode === 'full' || mode === 'work') && isHours(work) ? { mode, work } : null
  } catch {
    return null
  }
}

export function saveHours(choice: HoursChoice) {
  try {
    localStorage.setItem(HOURS_KEY, JSON.stringify(choice))
  } catch {}
}
