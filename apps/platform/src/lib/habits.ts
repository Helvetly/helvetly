import { useQueryClient } from '@tanstack/react-query'

import type { Session } from '@/lib/api'
import { queryKeys } from '@/lib/queries'

/**
 * What this person usually picks in new records, kept in the browser per user and workspace, so a new form
 * starts with their habits instead of the built-in fallbacks. Precedence, most specific first: what the form
 * gets from settings (the client's, then the workspace's) is passed in as fixed and never replaced; then the
 * habit for this client; then the habit overall; then the form's own default.
 */

/** A decayed count per value: `s` the score at time `at` (ms). */
type Tally = Record<string, { s: number; at: number }>
export type Habits = Record<string, Tally>

const HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000
/** Picked about twice recently: one odd choice does not change the next form. */
const MIN_SCORE = 1.5

const decay = (score: number, from: number, to: number) =>
  score * 0.5 ** (Math.max(0, to - from) / HALF_LIFE_MS)

const isTally = (value: unknown): value is Tally =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      'at' in entry &&
      's' in entry &&
      typeof entry.s === 'number' &&
      typeof entry.at === 'number',
  )

/** Parses what the browser kept; anything malformed starts over rather than breaking a form. */
export function parseHabits(raw: string | null): Habits {
  try {
    const data: unknown = raw ? JSON.parse(raw) : {}
    if (typeof data !== 'object' || data === null) return {}
    return Object.fromEntries(Object.entries(data).filter(([, tally]) => isTally(tally)))
  } catch {
    return {}
  }
}

export function learn(habits: Habits, key: string, value: string, now = Date.now()): Habits {
  const tally = habits[key] ?? {}
  const entry = tally[value]
  return {
    ...habits,
    [key]: { ...tally, [value]: { s: (entry ? decay(entry.s, entry.at, now) : 0) + 1, at: now } },
  }
}

/** The value picked most, recency-weighted, once it has been picked often enough; else null. */
export function preferred(
  habits: Habits,
  key: string,
  now = Date.now(),
  minScore = MIN_SCORE,
): string | null {
  let best: { value: string; score: number } | null = null
  for (const [value, { s, at }] of Object.entries(habits[key] ?? {})) {
    const score = decay(s, at, now)
    if (!best || score > best.score) best = { value, score }
  }
  return best && best.score >= minScore ? best.value : null
}

const keyOf = (form: string, field: string, scope?: string | null) =>
  scope ? `${form}.${field}@${scope}` : `${form}.${field}`

/**
 * Starts `values` with the habits for `fields`. `fixed` are the fields settings supplied (they win);
 * `allowed` narrows a field to the values the form still offers, so an old habit can't pick a removed option.
 */
export function withHabits<T extends Record<string, unknown>>(
  values: T,
  habits: Habits,
  form: string,
  fields: readonly (keyof T & string)[],
  options: {
    scope?: string | null
    fixed?: readonly (keyof T & string)[]
    /** Fields that follow the latest leaning after a single pick (a two-way choice such as company or person). */
    eager?: readonly (keyof T & string)[]
    allowed?: Partial<Record<keyof T & string, (value: string) => boolean>>
  } = {},
  now = Date.now(),
): T {
  const next: Record<string, unknown> = { ...values }
  for (const field of fields) {
    if (options.fixed?.includes(field)) continue
    const current = values[field]
    if (typeof current !== 'string' && typeof current !== 'boolean') continue
    const minScore = options.eager?.includes(field) ? 1 : MIN_SCORE
    const habit =
      (options.scope
        ? preferred(habits, keyOf(form, field, options.scope), now, minScore)
        : null) ?? preferred(habits, keyOf(form, field), now, minScore)
    if (habit === null || options.allowed?.[field]?.(habit) === false) continue
    if (typeof current === 'boolean') {
      if (habit === 'true' || habit === 'false') next[field] = habit === 'true'
    } else next[field] = habit
  }
  // Same keys, only string/boolean fields replaced by values of the same type.
  return { ...values, ...next }
}

/** Records what a saved record used for `fields`, overall and for `scope` (a client) when given. */
export function learnValues<T extends Record<string, unknown>>(
  habits: Habits,
  form: string,
  values: T,
  fields: readonly (keyof T & string)[],
  scope?: string | null,
  now = Date.now(),
): Habits {
  let next = habits
  for (const field of fields) {
    const value: unknown = values[field]
    if (typeof value !== 'string' && typeof value !== 'boolean') continue
    const text = String(value)
    if (text === '') continue
    next = learn(next, keyOf(form, field), text, now)
    if (scope) next = learn(next, keyOf(form, field, scope), text, now)
  }
  return next
}

const storageKey = (userId: string, workspaceId: string) =>
  `helvetly.habits.${userId}.${workspaceId}`

function load(key: string): Habits {
  try {
    return parseHabits(localStorage.getItem(key))
  } catch {
    return {}
  }
}

function save(key: string, habits: Habits) {
  try {
    localStorage.setItem(key, JSON.stringify(habits))
  } catch {
    // Private mode or a full quota: forms keep their own defaults.
  }
}

/** This person's habits in this workspace; empty without a loaded session (the app shell loads it). */
export function useHabits() {
  // Read from the cache, never fetched here: a form must not start a request of its own.
  const session = useQueryClient().getQueryData<Session>(queryKeys.session)
  const key = session ? storageKey(session.user.id, session.workspace.id) : null
  return {
    readHabits: () => (key ? load(key) : {}),
    remember: <T extends Record<string, unknown>>(
      form: string,
      values: T,
      fields: readonly (keyof T & string)[],
      scope?: string | null,
    ) => {
      if (key) save(key, learnValues(load(key), form, values, fields, scope))
    },
  }
}
