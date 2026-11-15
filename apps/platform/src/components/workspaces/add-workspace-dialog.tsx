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
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useCreateWorkspace } from '@/lib/members'

/**
 * A new, empty workspace with the person as owner. The session moves into it and its welcome
 * (/welcome) sets it up; it needs a plan of its own, billed on its own.
 */
export function AddWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const create = useCreateWorkspace()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError(translate('giveTheWorkspaceANameSuchAsMusterGmbH'))
      return
    }
    create.mutate(name.trim(), {
      onSuccess: () => router.replace('/welcome'),
      onError: (err) => setError(errorMessage(err)),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate('addWorkspace')}</DialogTitle>
          <DialogDescription>
            {translate('aSeparateCompanyOrProjectWithItsOwnClients')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <FormField
            id="workspace-name"
            label={translate('name')}
            required
            error={error}
            hint={translate('youCanRenameItLaterInSettings')}
          >
            <Input
              {...describedBy('workspace-name', error)}
              maxLength={100}
              placeholder={translate('musterGmbH')}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {translate('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? translate('creating') : translate('createWorkspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
