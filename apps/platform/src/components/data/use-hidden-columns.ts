import { useState } from 'react'

/** Which columns show: a per-browser choice, so storage may be missing. */
export function useHiddenColumns(storageKey: string, defaults: string[]) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (Array.isArray(stored)) return stored.filter((id): id is string => typeof id === 'string')
    } catch {}
    return defaults
  })
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((entry) => entry !== id) : [...hidden, id]
    setHidden(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
  }
  return { hidden, toggle }
}
