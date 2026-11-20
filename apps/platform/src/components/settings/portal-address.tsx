'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy } from '@helvetly/ui/components/form-field'
import { FieldError } from '@helvetly/ui/components/inline-error'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Check, CircleAlert, Copy, Globe, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { useSectionForm } from '@/components/section-form'
import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  usePortalAddress,
  useSetPortalAccess,
  useSetPortalSlug,
  useSlugAvailability,
  type PortalAddress,
  type SlugProblem,
} from '@/lib/workspaces'

import { HelpTip } from './help-tip'
import { SettingsSection } from './layout'
import { PortalDomainRow } from './portal-domain'

const problemText = (problem: SlugProblem) =>
  ({
    invalid: translate('portalSlugInvalid'),
    reserved: translate('portalSlugReserved'),
    taken: translate('portalSlugTaken'),
  })[problem]

const isProblem = (value: unknown): value is SlugProblem =>
  value === 'invalid' || value === 'reserved' || value === 'taken'

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/

/** "portal.helvetly.com" of "https://portal.helvetly.com/w/acme/". */
const hostOf = (address: PortalAddress) => new URL(address.url).host

/**
 * The client portal: on or off for the whole workspace, its address (the last part chosen by owners and admins,
 * checked while typing) and the workspace's own domain.
 */
export function PortalAddressSection({ canEdit }: { canEdit: boolean }) {
  const address = usePortalAddress().data
  // Keyed by the slug: a saved change starts the form again from the new one.
  return address ? (
    <PortalAddressForm key={address.slug} address={address} canEdit={canEdit} />
  ) : null
}

const title = (
  <span className="inline-flex items-center gap-1.5">
    {translate('portalAddress')}
    <HelpTip label={translate('portalAddress')}>{translate('portalAddressHelp')}</HelpTip>
  </span>
)

function CopyAddress({ url }: { url: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate('copyAddress')}
          className="text-muted-foreground"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast.success(translate('portalAddressCopied')))
          }
        >
          <Copy />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{translate('copyAddress')}</TooltipContent>
    </Tooltip>
  )
}

/** The switch for the whole portal; turning it off asks first, since it signs every client out. */
function PortalSwitch({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const access = useSetPortalAccess()
  const [confirming, setConfirming] = useState(false)
  const turn = (on: boolean) =>
    access.mutate(on, {
      onSuccess: () => toast.success(translate(on ? 'portalTurnedOn' : 'portalTurnedOff')),
      onError: toastError,
    })
  return (
    <>
      <SwitchRow
        id="portal-enabled"
        label={translate('clientPortal')}
        description={translate(enabled ? 'portalOnHint' : 'portalOffHint')}
        checked={enabled}
        disabled={access.isPending}
        disabledReason={canEdit ? undefined : translate('portalAccessAdminOnly')}
        onCheckedChange={(on) => (on ? turn(true) : setConfirming(true))}
      />
      {confirming && (
        <ConfirmDialog
          tone="destructive"
          title={translate('portalTurnOffTitle')}
          body={translate('portalTurnOffBody')}
          confirmLabel={translate('portalTurnOffConfirm')}
          onDecide={(approved) => {
            setConfirming(false)
            if (approved) turn(false)
          }}
        />
      )}
    </>
  )
}

/** What the check says about the typed slug, at the field's end: checking, available or a problem. */
function SlugStatus({ state }: { state: 'checking' | 'available' | 'problem' }) {
  if (state === 'checking')
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        <span className="max-sm:sr-only">{translate('checking')}</span>
      </span>
    )
  if (state === 'available')
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <Check aria-hidden className="size-3.5" />
        <span className="max-sm:sr-only">{translate('portalSlugAvailable')}</span>
      </span>
    )
  return <CircleAlert aria-hidden className="size-3.5 text-destructive" />
}

function PortalAddressForm({ address, canEdit }: { address: PortalAddress; canEdit: boolean }) {
  const setSlug = useSetPortalSlug()
  const form = useSectionForm({
    initial: { slug: address.slug },
    sections: [{ id: 'portal', fields: ['slug'] }],
    validate: (values) =>
      SLUG.test(values.slug.trim().toLowerCase()) ? {} : { slug: problemText('invalid') },
    save: (values) => setSlug.mutateAsync(values.slug.trim().toLowerCase()),
    fieldErrors: (error) => {
      const fields = error instanceof ApiError ? error.details.fields : null
      const problem =
        typeof fields === 'object' && fields !== null && 'slug' in fields ? fields.slug : null
      return isProblem(problem) ? { slug: problemText(problem) } : null
    },
    savedMessage: () => translate('portalAddressSaved'),
  })
  const section = form.section('portal')
  const typed = form.values.slug.trim().toLowerCase()
  const changed = canEdit && typed !== address.slug
  // A slug the pattern refuses is said at once; the server is asked only about well-formed ones.
  const malformed = changed && typed !== '' && !SLUG.test(typed)
  const availability = useSlugAvailability(malformed ? '' : typed, address.slug)
  const checking =
    changed &&
    !malformed &&
    typed !== '' &&
    // A check that failed (too many, offline) says nothing and holds nothing back: saving checks again.
    (!availability.settled ||
      availability.query.isFetching ||
      (!availability.query.data && !availability.query.isError))
  const checked = changed && !checking && !malformed ? availability.query.data : undefined
  const error =
    form.errors.slug ??
    (malformed
      ? problemText('invalid')
      : checked?.problem
        ? problemText(checked.problem)
        : undefined)
  const status = error ? 'problem' : checking ? 'checking' : checked?.available ? 'available' : null

  return (
    <SettingsSection
      id="portal-address"
      icon={Globe}
      title={title}
      // Save waits for the check and stays off for a slug that cannot be taken.
      section={
        canEdit ? { ...section, blocked: section.blocked || checking || Boolean(error) } : undefined
      }
    >
      <div className="grid max-w-[var(--settings-form,44rem)] gap-5">
        <PortalSwitch enabled={address.enabled} canEdit={canEdit} />
        <form
          noValidate
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!checking && !error) section.save()
          }}
        >
          <InputGroup className="bg-card">
            <InputGroupAddon>
              {/* One run of text (the group's gap would split it); a phone keeps only "…/w/" for the slug. */}
              <InputGroupText className="pr-0 text-muted-foreground">
                <span>
                  <span className="max-sm:hidden">https://{hostOf(address)}</span>
                  <span className="sm:hidden">…</span>/w/
                </span>
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              {...describedBy('portal-slug', error)}
              aria-label={translate('portalAddressField')}
              readOnly={!canEdit}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="pl-0!" // the slug follows the address without a gap (the group pads its input)
              maxLength={32}
              value={form.values.slug}
              onChange={(event) => form.set('slug', event.target.value)}
            />
            <InputGroupAddon align="inline-end" className="gap-2 text-body-sm">
              <output className="inline-flex">{status && <SlugStatus state={status} />}</output>
              <CopyAddress url={address.url} />
            </InputGroupAddon>
          </InputGroup>
          {error && <FieldError id="portal-slug-error">{error}</FieldError>}
        </form>
        <PortalDomainRow canEdit={canEdit} />
      </div>
    </SettingsSection>
  )
}
