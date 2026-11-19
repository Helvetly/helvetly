'use client'
import { Button } from '@helvetly/ui/components/button'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@helvetly/ui/components/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Check, Copy, Globe } from 'lucide-react'
import { toast } from 'sonner'

import { useSectionForm } from '@/components/section-form'
import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  usePortalAddress,
  useSetPortalSlug,
  useSlugAvailability,
  type PortalAddress,
  type SlugProblem,
} from '@/lib/workspaces'

import { HelpTip } from './help-tip'
import { FieldGrid, SettingsSection } from './layout'

const problemText = (problem: SlugProblem) =>
  ({
    invalid: translate('portalSlugInvalid'),
    reserved: translate('portalSlugReserved'),
    taken: translate('portalSlugTaken'),
  })[problem]

const isProblem = (value: unknown): value is SlugProblem =>
  value === 'invalid' || value === 'reserved' || value === 'taken'

/** "portal.helvetly.com/w/" of "https://portal.helvetly.com/w/acme/". */
const prefixOf = (address: PortalAddress) =>
  address.url.replace(/^https?:\/\//, '').slice(0, -(address.slug.length + 1))

/** The workspace's own portal address, copied with one click; owners and admins choose its last part. */
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
          size="icon-sm"
          aria-label={translate('copyPortalAddress')}
          className="text-muted-foreground"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast(translate('portalAddressCopied')))
          }
        >
          <Copy />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{translate('copyPortalAddress')}</TooltipContent>
    </Tooltip>
  )
}

function PortalAddressForm({ address, canEdit }: { address: PortalAddress; canEdit: boolean }) {
  const setSlug = useSetPortalSlug()
  const form = useSectionForm({
    initial: { slug: address.slug },
    sections: [{ id: 'portal', fields: ['slug'] }],
    validate: (values) =>
      /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(values.slug.trim().toLowerCase())
        ? {}
        : { slug: problemText('invalid') },
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
  const availability = useSlugAvailability(typed, address.slug)
  const checked = availability.data && !availability.isFetching ? availability.data : null
  const error = form.errors.slug ?? (checked?.problem ? problemText(checked.problem) : undefined)
  const hint =
    checked?.available && typed !== address.slug ? (
      <span className="inline-flex items-center gap-1 text-success">
        <Check aria-hidden className="size-3.5" />
        {translate('portalSlugAvailable')}
      </span>
    ) : (
      translate('portalSlugHint')
    )

  return (
    <SettingsSection
      id="portal-address"
      icon={Globe}
      title={title}
      section={canEdit ? section : undefined}
    >
      <div className="grid gap-4">
        <p className="flex min-w-0 items-center gap-1 text-body">
          <a
            href={address.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground"
          >
            {address.url.replace(/^https?:\/\//, '')}
          </a>
          <CopyAddress url={address.url} />
        </p>
        {canEdit && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              section.save()
            }}
            noValidate
          >
            <FieldGrid>
              <FormField
                id="portal-slug"
                required
                label={translate('portalSlug')}
                width="md"
                error={error}
                hint={error ? undefined : hint}
              >
                <InputGroup className="bg-card">
                  <InputGroupAddon>
                    <InputGroupText className="text-muted-foreground">
                      {prefixOf(address)}
                    </InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    {...describedBy('portal-slug', error)}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={32}
                    value={form.values.slug}
                    onChange={(event) => form.set('slug', event.target.value)}
                  />
                </InputGroup>
              </FormField>
            </FieldGrid>
          </form>
        )}
      </div>
    </SettingsSection>
  )
}
