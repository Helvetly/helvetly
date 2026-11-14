'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

type PrimaryAction = { label: string; run: () => void }

// Two contexts, so the page that publishes its action does not re-render when it changes.
const SetPrimary = createContext<(action: PrimaryAction | null) => void>(() => {})
const Primary = createContext<PrimaryAction | null>(null)

/** Carries the open page's primary action (e.g. "New invoice") to the phone's bottom "+". */
export function PrimaryActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<PrimaryAction | null>(null)
  return (
    <SetPrimary value={setAction}>
      <Primary value={action}>{children}</Primary>
    </SetPrimary>
  )
}

/** Publishes the page's primary action while it is on screen; no label publishes nothing. */
export function usePublishPrimary(label: string | undefined, run: () => void) {
  const set = useContext(SetPrimary)
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  useEffect(() => {
    if (!label) return
    set({ label, run: () => latest.current() })
    return () => set(null)
  }, [label, set])
}

export const usePrimaryAction = () => useContext(Primary)
