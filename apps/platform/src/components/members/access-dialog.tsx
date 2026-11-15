'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { scopesProblem, useChangeScopes, type Member } from '@/lib/members'
import { EVERYTHING } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

import { AccessEditor } from './access-editor'

/** Change what a member may see and edit; it applies on their next request. */
export function AccessDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const [scopes, setScopes] = useState<string[]>(member.scopes ?? EVERYTHING)
  const [problem, setProblem] = useState<string | null>(null)
  const change = useChangeScopes()
  const owner = useSession().data?.role === 'owner'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem(null)
    change.mutate(
      { user_id: member.user_id, scopes },
      {
        onSuccess: () => {
          toast.success(`Access for ${member.name} changed.`)
          onClose()
        },
        onError: (error) => {
          const scopeProblem = scopesProblem(error)
          if (scopeProblem) setProblem(scopeProblem)
          else toastError(error)
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Access for {member.name}</DialogTitle>
          <DialogDescription>
            What this member can see and change in the workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <AccessEditor value={scopes} onChange={setScopes} error={problem} canChangeHR={owner} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={change.isPending || scopes.length === 0}>
              Save access
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
