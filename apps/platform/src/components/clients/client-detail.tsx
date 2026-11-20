'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { formatDate } from '@helvetly/ui/lib/format'
import { displayPhone } from '@helvetly/ui/lib/phone'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowUpRight,
  Copy,
  Globe,
  Hash,
  Mail,
  MapPin,
  Phone,
  Receipt,
  Send,
  StickyNote,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { ClientEngagements } from '@/components/clients/client-engagements'
import { ImportDrawer } from '@/components/import/import-drawer'
import { EditableValue, InlineAdd, InlineTextEditor } from '@/components/inline-add'
import { ClientInvoices } from '@/components/invoices/client-invoices'
import { ClientQuotes } from '@/components/quotes/client-quotes'
import { FillTemplateDrawer } from '@/components/templates/fill-drawer'
import { ApiError, errorMessage } from '@/lib/api'
import { clientsApi, useClient, useSaveClient, type Client, type ClientInput } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { useCan } from '@/lib/permissions'

import { ChangeRequestBanner } from './change-request-banner'
import { addressLines } from './client-bits'
import { ClientContacts } from './client-contacts'
import { ClientFiles } from './client-files'
import {
  ADDRESS_LABELS,
  countryName,
  CURRENCIES,
  formatUid,
  LANGUAGE_OPTIONS,
} from './client-form-model'
import { ClientHeader, mapsHref, websiteHref } from './client-header'
import { PortalAccess } from './client-portal'
import { InlineTagsEditor } from './inline-tags'
import { SelfBillingAgreements } from './self-billing-agreements'

/** A label/value row; a missing value offers to add it instead of showing a dash. */
function Row({
  icon: Icon,
  label,
  value,
  copy,
  addLabel,
  editLabel,
  onAdd,
  inline,
  editor,
  editing = false,
  onEdit,
  top = false,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  /** Text the copy button puts on the clipboard. */
  copy?: string | null
  /** The empty value's link text; defaults to "Add <label>". */
  addLabel?: string
  onAdd: () => void
  /** Adds the missing value in place instead of opening the full edit. */
  inline?: Omit<ComponentProps<typeof InlineAdd>, 'label'>
  /** Adds or changes the value in place, shown while `editing`; `onEdit` opens it. Takes over from `inline`. */
  editor?: ReactNode
  editing?: boolean
  onEdit?: () => void
  /** The tooltip of a value that opens `editor`; defaults to "Edit <label>". */
  editLabel?: string
  /** A tall editor (a note): the icon and label stay on the first line instead of moving to its middle. */
  top?: boolean
}) {
  const add = (
    <button
      type="button"
      onClick={onEdit ?? onAdd}
      className="cursor-pointer text-link underline underline-offset-2 hover:no-underline"
    >
      {addLabel ?? translate('add', { value1: label.toLowerCase() })}
    </button>
  )
  return (
    // min-h-11: an open editor's input and its focus ring keep clear of the separators.
    <div
      className={cn(
        'group/row flex min-h-11 gap-3 border-t border-border/60 first:border-t-0',
        top ? 'items-start' : 'items-center',
      )}
    >
      <Icon className={cn('size-4 shrink-0 stroke-[1.5] text-muted-foreground', top && 'mt-3.5')} />
      <span className={cn('w-28 shrink-0 text-[13.5px] text-muted-foreground', top && 'mt-3')}>
        {label}
      </span>
      {/* Only a value truncates: the inline input's focus ring must not be clipped by overflow. */}
      <span className={cn('min-w-0 flex-1 text-[14px]', value && !onEdit && 'truncate')}>
        {editor && editing ? (
          editor
        ) : onEdit && value ? (
          <EditableValue
            label={editLabel ?? translate('edit2', { value1: label.toLowerCase() })}
            onEdit={onEdit}
            className="-mx-1.5 w-[calc(100%+0.75rem)] px-1.5 py-1"
          >
            <span className="block truncate">{value}</span>
          </EditableValue>
        ) : (
          (value ??
          (inline && !onEdit ? (
            <InlineAdd
              label={addLabel ?? translate('add', { value1: label.toLowerCase() })}
              {...inline}
            />
          ) : (
            add
          )))
        )}
      </span>
      {copy && !editing && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('copy3', { value1: label.toLowerCase() })}
          className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
          onClick={() =>
            void navigator.clipboard
              .writeText(copy)
              .then(() => toast.success(translate('copied', { label: label })))
          }
        >
          <Copy />
        </Button>
      )}
    </div>
  )
}

/** A field of the "Internal" panel; `save` is missing without the right to change clients (add opens the form). */
type InternalField<T> = {
  onAdd: () => void
  save?: (value: T) => Promise<unknown>
}

function InternalIdRow({ value, onAdd, save }: InternalField<string> & { value: string | null }) {
  const [editing, setEditing] = useState(false)
  return (
    <Row
      icon={Hash}
      label={translate('internalID')}
      addLabel={translate('addInternalID')}
      editLabel={translate('editInternalID')}
      copy={value}
      onAdd={onAdd}
      value={value}
      editing={editing}
      onEdit={save && (() => setEditing(true))}
      editor={
        save && (
          <InlineTextEditor
            label={translate('internalID')}
            initial={value ?? ''}
            placeholder={translate('k1042')}
            save={save}
            onDone={() => setEditing(false)}
          />
        )
      }
    />
  )
}

function TagsRow({ tags, onAdd, save }: InternalField<string[]> & { tags: string[] }) {
  const [editing, setEditing] = useState(false)
  return (
    <Row
      icon={Tag}
      label={translate('tags')}
      onAdd={onAdd}
      editing={editing}
      onEdit={save && (() => setEditing(true))}
      editor={
        save && <InlineTagsEditor initial={tags} save={save} onDone={() => setEditing(false)} />
      }
      value={
        tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[12.5px]">
                {tag}
              </span>
            ))}
          </span>
        ) : null
      }
    />
  )
}

/** The internal note: a block of text that turns into a textarea in place when clicked. */
function ClientNote({ note, onAdd, save }: InternalField<string> & { note: string | null }) {
  const [editing, setEditing] = useState(false)
  const editor = save && (
    <InlineTextEditor
      label={translate('note')}
      multiline
      maxLength={1000}
      initial={note ?? ''}
      placeholder={translate('onlyYourTeamSeesThis')}
      save={save}
      onDone={() => setEditing(false)}
    />
  )
  const onEdit = save && (() => setEditing(true))
  if (!note)
    return (
      <Row
        icon={StickyNote}
        label={translate('note')}
        onAdd={onAdd}
        value={null}
        editing={editing}
        onEdit={onEdit}
        editor={editor}
        top={editing}
      />
    )
  const text = (
    <span className="block text-[13.5px] leading-relaxed whitespace-pre-wrap">{note}</span>
  )
  if (!onEdit) return <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2.5">{text}</p>
  if (editing) return <div className="mt-2 flex">{editor}</div>
  return (
    <EditableValue
      label={translate('editNote')}
      onEdit={onEdit}
      className="mt-2 items-start bg-muted/60 px-3 py-2.5 hover:bg-muted"
      // Centred on the note's first line (relaxed 13.5px text, 22px high), however long the note is.
      pencilClassName="mt-1"
    >
      {text}
    </EditableValue>
  )
}

/** A rejected field's own message ("Enter the number in international format…") instead of the generic one. */
function fieldError(failure: unknown): unknown {
  const fields = failure instanceof ApiError ? failure.details.fields : undefined
  const first = fields && typeof fields === 'object' ? Object.values(fields)[0] : undefined
  return typeof first === 'string' ? new Error(first) : failure
}

const languageName = (code: string | null) =>
  code ? (LANGUAGE_OPTIONS.find((option) => option.code === code)?.name ?? code) : null
const currencyName = (code: string | null) =>
  code ? `${code} · ${CURRENCIES.find((currency) => currency.code === code)?.name ?? ''}` : null

export type ClientCommand = 'edit' | 'complete' | 'toggle' | 'delete'

/** One client, in a sheet from the right (full screen on phones). */
export function ClientDetail({
  id,
  canDelete,
  onClose,
  onCommand,
}: {
  id: string
  canDelete: boolean
  onClose: () => void
  onCommand: (command: ClientCommand, client: Client) => void
}) {
  const query = useClient(id)
  const client = query.data

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 sm:w-[min(1020px,100vw)]! dark:bg-background"
      >
        <SheetTitle className="sr-only">{client?.name ?? translate('client')}</SheetTitle>
        <SheetDescription className="sr-only">{translate('clientDetails')}</SheetDescription>
        {client ? (
          <Detail client={client} canDelete={canDelete} onClose={onClose} onCommand={onCommand} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-[15px]">{translate('thisClientCouldnTBeLoaded')}</p>
            <p className="text-sm text-muted-foreground">{errorMessage(query.error)}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('tryAgain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {translate('close')}
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

function Detail({
  client,
  canDelete,
  onClose,
  onCommand,
}: {
  client: Client
  canDelete: boolean
  onClose: () => void
  onCommand: (command: ClientCommand, client: Client) => void
}) {
  const lines = addressLines(client)
  const missing = client.missing_fields.map((field) => ADDRESS_LABELS[field])
  const country = client.country ? countryName(client.country) : null
  const edit = () => onCommand('edit', client)
  const saveClient = useSaveClient()
  const canWrite = useCan('write:clients')
  /** One field saved from the page; null without the right to change clients (the link opens the form). */
  const inline = (
    toInput: (text: string) => Partial<ClientInput> | Promise<Partial<ClientInput>>,
    options: { placeholder?: string; mono?: boolean; pendingHint?: string } = {},
  ) =>
    canWrite
      ? {
          ...options,
          save: async (text: string) => {
            try {
              return await saveClient.mutateAsync({ id: client.id, input: await toInput(text) })
            } catch (failure) {
              throw fieldError(failure)
            }
          },
        }
      : undefined
  const save = (input: Partial<ClientInput>) => saveClient.mutateAsync({ id: client.id, input })
  const filled = 5 - client.missing_fields.length
  const [filling, setFilling] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const canImportInvoices = useCan('write:invoices')

  return (
    <Tabs defaultValue="overview" className="min-h-full gap-0">
      <ClientHeader
        client={client}
        canDelete={canDelete}
        onClose={onClose}
        onEdit={edit}
        onToggle={() => onCommand('toggle', client)}
        onDelete={() => onCommand('delete', client)}
        onFillTemplate={() => setFilling(true)}
        onImportInvoices={canImportInvoices ? () => setImporting(true) : undefined}
        tabs={
          <>
            {/* Scrolls sideways on phones; the padding gives the focus rings room inside the scroller. */}
            <div className="-mx-4 -my-1 [scrollbar-width:none] overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6">
              <TabsList variant="line" className="-mb-px h-10 gap-4 p-0">
                {[
                  { value: 'overview', label: translate('overview') },
                  {
                    value: 'contacts',
                    label: translate('contacts'),
                    count: client.contacts.length,
                  },
                  { value: 'files', label: translate('files'), count: client.files_count },
                  { value: 'invoices', label: translate('invoices') },
                  { value: 'quotes', label: translate('quotes') },
                  { value: 'engagements', label: translate('engagements') },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="h-full flex-none px-0 text-[14px] font-normal after:bottom-0! after:h-[2px] after:bg-primary"
                  >
                    {tab.label}
                    {Boolean(tab.count) && (
                      <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">
                        {tab.count}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </>
        }
      />

      <ChangeRequestBanner
        client={client}
        canDecide={canDelete}
        reviewing={reviewing}
        onReviewingChange={setReviewing}
      />

      <TabsContent
        value="overview"
        className="grid grid-cols-[minmax(0,1fr)] content-start gap-3 p-4 sm:p-5"
      >
        {client.is_draft && (
          <Callout
            tone="warning"
            title={translate('finishTheAddressToStartInvoicing')}
            actions={
              <Button onClick={() => onCommand('complete', client)}>{translate('complete')}</Button>
            }
          >
            <div className="grid gap-3">
              <p className="text-muted-foreground">
                {translate('missing')}
                {missing.join(', ')}
              </p>
              <div aria-hidden className="grid grid-cols-5 gap-1">
                {Array.from({ length: 5 }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1 rounded-full',
                      i < filled ? 'bg-warning-solid' : 'bg-warning-border',
                    )}
                  />
                ))}
              </div>
            </div>
          </Callout>
        )}

        <Panel title={translate('contact')}>
          <Row
            icon={Mail}
            label={translate('email')}
            copy={client.email}
            onAdd={edit}
            inline={inline((text) => ({ email: text }), {
              placeholder: translate('helloExampleCh'),
            })}
            value={
              client.email && (
                <a
                  href={localizedHref(`mailto:${client.email}`)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {client.email}
                </a>
              )
            }
          />
          <Row
            icon={Phone}
            label={translate('phone')}
            copy={client.phone && displayPhone(client.phone)}
            onAdd={edit}
            inline={inline((text) => ({ phone: text }), { placeholder: '+41 44 123 45 67' })}
            value={
              client.phone && (
                <a
                  href={localizedHref(`tel:${client.phone}`)}
                  className="tabular-nums underline underline-offset-2 hover:no-underline"
                >
                  {displayPhone(client.phone)}
                </a>
              )
            }
          />
          <Row
            icon={Globe}
            label={translate('website')}
            onAdd={edit}
            // The API checks the site answers and gives the address it really answers on (https, redirects followed).
            inline={inline(
              async (text) => ({ website: (await clientsApi.checkWebsite(text)).data.website }),
              { placeholder: 'example.ch', pendingHint: translate('checkingTheSite') },
            )}
            value={
              client.website && (
                <a
                  href={localizedHref(websiteHref(client.website))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
                >
                  {client.website.replace(/^https?:\/\//i, '')}
                  <ArrowUpRight className="size-3.5 text-muted-foreground" />
                </a>
              )
            }
          />
        </Panel>

        <Panel
          title={translate('address')}
          action={
            lines.length > 0 && (
              <a
                href={localizedHref(mapsHref([...lines, country].join(', ')))}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                {translate('openInMaps')}
                <ArrowUpRight className="size-3.5" />
              </a>
            )
          }
        >
          {lines.length || country ? (
            <address className="flex items-start gap-3 py-1 text-[14px] leading-relaxed not-italic">
              <MapPin className="mt-1 size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
              <span>
                {lines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
                {country && <span className="block text-muted-foreground">{country}</span>}
              </span>
            </address>
          ) : (
            <button
              type="button"
              onClick={() => onCommand('complete', client)}
              className="flex min-h-10 items-center gap-3 text-[14px] text-muted-foreground/80 hover:text-foreground"
            >
              <MapPin className="size-4 stroke-[1.5]" />
              {translate('addAddress')}
            </button>
          )}
        </Panel>

        <Panel title={translate('billing')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              {
                label: translate('currency'),
                value: client.currency ?? '—',
                hint: currencyName(client.currency)?.split(' · ')[1],
              },
              {
                label: translate('paymentTerms'),
                value:
                  client.payment_terms_days === null ? '—' : `${client.payment_terms_days} days`,
              },
              { label: translate('documentsIn'), value: languageName(client.language) ?? '—' },
            ].map((tile) => (
              <div key={tile.label} className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2.5">
                <span className="text-[12px] text-muted-foreground">{tile.label}</span>
                <span className="truncate text-[15px] font-medium" title={tile.hint}>
                  {tile.value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Row
              icon={Receipt}
              label={translate('vatUID')}
              addLabel={translate('addVATNumber')}
              copy={client.vat_number}
              onAdd={edit}
              inline={inline((text) => ({ vat_number: formatUid(text) }), {
                placeholder: translate('che123456789MWST'),
                mono: true,
              })}
              value={client.vat_number && <span className="font-code">{client.vat_number}</span>}
            />
            <Row
              icon={Send}
              label={translate('invoicesTo')}
              addLabel={translate('addBillingEmail')}
              onAdd={edit}
              inline={inline((text) => ({ billing_email: text }), {
                placeholder: translate('accountsExampleCh'),
              })}
              value={
                (client.billing_email ?? client.email) && (
                  <span>
                    {client.billing_email ?? client.email}
                    {!client.billing_email && (
                      <span className="text-muted-foreground">{translate('mainEmail')}</span>
                    )}
                  </span>
                )
              }
            />
          </div>
        </Panel>

        <Panel
          title={translate('clientPortal')}
          action={
            <Switch
              aria-label={translate('clientPortal')}
              checked={Boolean(client.portal_enabled)}
              disabled={!canWrite || saveClient.isPending}
              onCheckedChange={(on) =>
                saveClient.mutate(
                  { id: client.id, input: { portal_enabled: on } },
                  {
                    onSuccess: () =>
                      toast.success(
                        on ? translate('clientPortalOn') : translate('clientPortalOff'),
                      ),
                    onError: toastError,
                  },
                )
              }
            />
          }
        >
          <PortalAccess client={client} canWrite={canWrite} onAddEmail={edit} />
        </Panel>

        <Panel title={translate('internal')}>
          <InternalIdRow
            value={client.internal_id}
            onAdd={edit}
            save={canWrite ? (text) => save({ internal_id: text }) : undefined}
          />
          <TagsRow
            tags={client.tags}
            onAdd={edit}
            save={canWrite ? (tags) => save({ tags }) : undefined}
          />
          <ClientNote
            note={client.note}
            onAdd={edit}
            save={canWrite ? (text) => save({ note: text }) : undefined}
          />
        </Panel>

        <SelfBillingAgreements clientId={client.id} />

        <p className="px-1 pt-1 text-xs text-muted-foreground">
          {translate('added2')}
          {formatDate(client.created_at)}
          {translate('updated')}
          {formatDate(client.updated_at)}
        </p>
      </TabsContent>

      <TabsContent value="contacts" className="p-4 sm:p-5">
        <Panel title={translate('contactPersons')}>
          <ClientContacts client={client} />
        </Panel>
      </TabsContent>

      <TabsContent value="files" className="p-4 sm:p-5">
        <ClientFiles clientId={client.id} />
      </TabsContent>

      <TabsContent value="invoices" className="p-4 sm:p-5">
        <ClientInvoices clientId={client.id} />
      </TabsContent>

      <TabsContent value="quotes" className="p-4 sm:p-5">
        <ClientQuotes clientId={client.id} />
      </TabsContent>

      <TabsContent value="engagements" className="p-4 sm:p-5">
        <ClientEngagements clientId={client.id} />
      </TabsContent>
      {filling && (
        <FillTemplateDrawer template={null} client={client} onClose={() => setFilling(false)} />
      )}
      {importing && (
        <ImportDrawer
          kind="invoices"
          client={{ id: client.id, name: client.name }}
          onClose={() => setImporting(false)}
        />
      )}
    </Tabs>
  )
}
