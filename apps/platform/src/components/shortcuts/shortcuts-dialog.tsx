'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'

import { SHORTCUTS, type Shortcut, type ShortcutId } from '@/lib/shortcuts'

import { ShortcutKeys } from './shortcut-keys'

const GROUPS: Shortcut['group'][] = ['General', 'Navigation', 'Appearance', 'On a page']

const entries = Object.entries(SHORTCUTS) as [ShortcutId, Shortcut][]

/** Every keyboard shortcut, grouped; opened with "?" or from the account menu. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Single keys work when you are not typing in a field.
          </DialogDescription>
        </DialogHeader>
        {GROUPS.map((group) => (
          <section key={group} aria-labelledby={`shortcuts-${group}`} className="grid gap-1">
            <h3
              id={`shortcuts-${group}`}
              className="text-caption font-medium text-muted-foreground"
            >
              {group}
            </h3>
            <dl className="divide-y divide-border/60">
              {entries
                .filter(([, shortcut]) => shortcut.group === group)
                .map(([id, shortcut]) => (
                  <div key={id} className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-body-sm">{shortcut.label}</dt>
                    <dd>
                      <ShortcutKeys id={id} all decorative={false} />
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
