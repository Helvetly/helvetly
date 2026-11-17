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
import { Flag } from '@helvetly/ui/components/flag'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { LanguageDialogButton, useCurrentLanguage } from '@helvetly/ui/components/language-switcher'
import { Loader } from '@helvetly/ui/components/loader'
import { Download, Languages, UserRound, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { useRedirectToPrefs } from '@/components/notifications/prefs-drawer'
import { MAX_PERSON_NAME } from '@/components/onboarding/onboarding-model'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import { DangerRow, DangerZone } from '@/components/settings/danger-zone'
import {
  ActionRow,
  FieldGrid,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { useDeleteAccount, useUpdateProfile } from '@/lib/account'
import { setCsrfToken, type User } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

import { DeletedWorkspaces } from './deleted-workspaces'
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
        title={translate('accountSettings')}
        description={translate('yourProfileAndHowYouSignInTheseFollow')}
      >
        {user ? (
          <>
            <Profile user={user} />
            <Language />
            <SignInMethods email={user.email} />
            <TwoFactor />
            <Sessions />
            <DeletedWorkspaces />
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
    validate: ({ name }) => (name.trim() ? {} : { name: translate('enterYourName') }),
    save: ({ name }) => update.mutateAsync({ name: name.trim() }),
    fieldErrors: apiFieldErrors,
    savedMessage: () => translate('profileSaved'),
  })
  const section = form.section('profile')
  return (
    <SettingsSection
      id="profile"
      icon={UserRound}
      title={translate('profile')}
      description={translate('howYouAppearToYourTeamOnActivityAnd')}
      section={section}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
        noValidate
      >
        <FormField id="profile-photo" label={translate('photo')} group>
          <ProfilePhoto user={user} name={form.saved.name || user.email} />
        </FormField>
        <FieldGrid>
          <FormField
            id="profile-name"
            required
            label={translate('fullName')}
            error={form.errors.name}
            width="md"
          >
            <Input
              {...describedBy('profile-name', form.errors.name)}
              maxLength={MAX_PERSON_NAME}
              autoComplete="name"
              placeholder={translate('annaMuster')}
              value={form.values.name}
              onChange={(event) => form.set('name', event.target.value)}
            />
          </FormField>
          <FormField
            id="profile-email"
            label={translate('email')}
            width="md"
            tip={translate('yourSignInAddressSignInCodesAndNotices')}
          >
            <Input id="profile-email" value={user.email} disabled />
          </FormField>
        </FieldGrid>
      </form>
    </SettingsSection>
  )
}

/** The interface language, kept in this browser: a reload shows every label in it. */
function Language() {
  const language = useCurrentLanguage()
  return (
    <SettingsSection
      id="language"
      icon={Languages}
      title={translate('language')}
      description={translate('theLanguageOfHelvetlyInThisBrowser')}
    >
      <ul className="grid">
        <SettingsRow
          icon={<Flag region={language.region} className="h-3 w-4 rounded-xs" />}
          title={language.name}
        >
          <LanguageDialogButton>
            <Button variant="outline" size="sm">
              {translate('change')}
            </Button>
          </LanguageDialogButton>
        </SettingsRow>
      </ul>
    </SettingsSection>
  )
}

function ExportAccount() {
  return (
    <SettingsSection id="export-account" icon={Download} title={translate('yourData')}>
      <ActionRow
        title={translate('exportMyData')}
        description={translate('aJSONFileWithWhatHelvetlyHoldsAboutYou')}
      >
        <Button asChild size="sm" variant="outline">
          <a href="/api/v1/account/export" download>
            {translate('downloadMyData')}
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
        title={translate('deleteAccount')}
        description={translate('removesYouFromEveryWorkspaceAndSignsYouOut')}
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
          <DialogTitle>{translate('deleteYourAccount')}</DialogTitle>
          <DialogDescription>
            {translate('youLeaveEveryWorkspaceAndThisAccountIsClosed')}
            {email}
            {translate('createsANewAccountWorkspaceRecordsStayWithTheir')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <FormField
            id="delete-account-confirm"
            label={translate('typeToConfirm', { email: email })}
          >
            <Input
              id="delete-account-confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              {translate('keepIt')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={typed.trim() !== email || remove.isPending}
            >
              <Trash2 /> {remove.isPending ? translate('deleting') : translate('deleteAccount')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
