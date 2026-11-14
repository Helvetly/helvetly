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
import { Loader } from '@helvetly/ui/components/loader'
import { Download, UserRound, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { useRedirectToPrefs } from '@/components/notifications/prefs-drawer'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { DangerRow, DangerZone } from '@/components/settings/danger-zone'
import { ActionRow, FieldGrid, SettingsPage, SettingsSection } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { useDeleteAccount, useUpdateProfile } from '@/lib/account'
import { setCsrfToken, type User } from '@/lib/api'
import { useSession } from '@/lib/queries'

import { ProfilePhoto } from './profile-photo'
import { Sessions } from './sessions'
import { SignInMethods } from './sign-in-methods'
import { TwoFactor } from './two-factor'

/** The person's own settings, the same in every workspace: profile, sign-in, 2FA, sessions. API tokens: Settings → API & MCP. */
export function AccountSettings() {
  const user = useSession().data?.user
  // Notifications were a section of this page: old links (emails, the bell) open their drawer.
  useRedirectToPrefs('#notifications')
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="Account settings"
        description="Your profile and how you sign in. These follow you into every workspace you belong to."
      >
        {user ? (
          <>
            <Profile user={user} />
            <SignInMethods email={user.email} />
            <TwoFactor />
            <Sessions />
            <ExportAccount />
            <DeleteAccount email={user.email} />
          </>
        ) : (
          <Loader className="min-h-40" />
        )}
      </SettingsPage>
    </>
  )
}

function Profile({ user }: { user: User }) {
  const update = useUpdateProfile()
  const form = useSectionForm({
    initial: { name: user.name },
    sections: [{ id: 'profile', fields: ['name'] }],
    validate: ({ name }) => (name.trim() ? {} : { name: 'Enter your name.' }),
    save: ({ name }) => update.mutateAsync({ name: name.trim() }),
    fieldErrors: apiFieldErrors,
    savedMessage: () => 'Profile saved.',
  })
  const section = form.section('profile')
  return (
    <SettingsSection
      id="profile"
      icon={UserRound}
      title="Profile"
      description="How you appear to your team, on activity and in emails Helvetly sends for you."
      section={section}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
        noValidate
      >
        <FormField id="profile-photo" label="Photo" group>
          <ProfilePhoto user={user} name={form.saved.name || user.email} />
        </FormField>
        <FieldGrid>
          <FormField id="profile-name" label="Full name" error={form.errors.name} width="md">
            <Input
              {...describedBy('profile-name', form.errors.name)}
              autoComplete="name"
              placeholder="Anna Muster"
              value={form.values.name}
              onChange={(event) => form.set('name', event.target.value)}
            />
          </FormField>
          <FormField
            id="profile-email"
            label="Email"
            width="md"
            tip="Your sign-in address. Sign-in codes and notices go here."
          >
            <Input id="profile-email" value={user.email} disabled />
          </FormField>
        </FieldGrid>
      </form>
    </SettingsSection>
  )
}

function ExportAccount() {
  return (
    <SettingsSection id="export-account" icon={Download} title="Your data">
      <ActionRow
        title="Export my data"
        description="A JSON file with what Helvetly holds about you: profile, sign-in methods, passkeys, sessions, API tokens, workspaces and your Heidi conversations. Business records belong to each workspace; an owner exports those."
      >
        <Button asChild size="sm" variant="outline">
          <a href="/api/v1/account/export" download>
            Download my data
          </a>
        </Button>
      </ActionRow>
    </SettingsSection>
  )
}

function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  return (
    <DangerZone id="delete-account">
      <DangerRow
        title="Delete account"
        description="Removes you from every workspace and signs you out everywhere. Transfer ownership or delete workspaces where you are the last owner first. This can’t be undone."
        action="Delete account"
        onAction={() => setOpen(true)}
      />
      {open && <DeleteDialog email={email} onClose={() => setOpen(false)} />}
    </DangerZone>
  )
}

function DeleteDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const router = useRouter()
  const remove = useDeleteAccount()
  const [typed, setTyped] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    remove.mutate(typed.trim(), {
      onSuccess: () => {
        setCsrfToken('')
        router.replace('/login')
      },
      onError: toastError,
    })
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            You leave every workspace and this account is closed. Signing in again with {email}
            creates a new account. Workspace records stay with their workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <FormField id="delete-account-confirm" label={`Type ${email} to confirm`}>
            <Input
              id="delete-account-confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              Keep it
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={typed.trim() !== email || remove.isPending}
            >
              <Trash2 /> {remove.isPending ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
