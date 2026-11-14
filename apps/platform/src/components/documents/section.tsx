import { cn } from '@helvetly/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export type SectionId = 'folders' | 'recent' | 'files'

const STORAGE_KEY = 'helvetly:documents-collapsed'
const SECTIONS: ReadonlySet<unknown> = new Set(['folders', 'recent', 'files'])
const isSection = (value: unknown): value is SectionId => SECTIONS.has(value)

/** Storage is the person's own, but can hold anything: keep only known section ids. */
export function parseCollapsed(raw: string | null): Set<SectionId> {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return new Set(Array.isArray(value) ? value.filter(isSection) : [])
  } catch {
    return new Set()
  }
}

/** Which grid sections are folded away, remembered in this browser. */
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionId>>(() => {
    try {
      return parseCollapsed(localStorage.getItem(STORAGE_KEY))
    } catch {
      return new Set()
    }
  })
  const toggle = (id: SectionId) => {
    const next = new Set(collapsed)
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {}
  }
  return { collapsed, toggle }
}

/** A titled block of the grid that folds away from its chevron. */
export function Section({
  title,
  hint,
  collapsed,
  onToggle,
  children,
}: {
  title: string
  hint?: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline gap-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="-ml-1.5 flex cursor-pointer items-center gap-1 rounded-md py-0.5 pr-1.5 pl-1 text-[14px] font-medium text-foreground outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronDown
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-200',
              collapsed && '-rotate-90',
            )}
          />
          {title}
        </button>
        {hint && !collapsed && (
          <span className="truncate text-[12.5px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {!collapsed && children}
    </section>
  )
}
