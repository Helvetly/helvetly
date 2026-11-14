'use client'

import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Textarea } from '@helvetly/ui/components/textarea'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  Check,
  FileDown,
  FileSignature,
  LayoutTemplate,
  Loader2,
  Mail,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { fieldCaption, serverProblem } from '@/components/signatures/create-drawer'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview } from '@/components/signatures/pdf-parts'
import { Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { useClientSearch, type Client } from '@/lib/clients'
import { checkSigners, signerColor, type DraftSigner, type SigningOrder } from '@/lib/signatures'
import {
  DATA_LABELS,
  defaultSigners,
  generateProblem,
  initialValues,
  isDataKind,
  primaryContact,
  templatesApi,
  toDraftFields,
  useTemplateMutation,
  useTemplates,
  valueKey,
  valuesByField,
  type DeliveryType,
  type GenerateRequest,
  type Template,
  type TemplateDraftField,
  ROLE_LANE,
} from '@/lib/templates'

const STEPS = ['Template & client', 'Fill in', 'Send'] as const

/**
 * Make a document from a template for one client: the client's details fill the template, then it
 * is saved to Documents, emailed, or (when the template asks for signatures) sent to sign.
 */
export function FillTemplateDrawer({
  template: initialTemplate,
  client: initialClient,
  onClose,
}: {
  template: Template | null
  client: Client | null
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const [template, setTemplate] = useState(initialTemplate)
  const [client, setClient] = useState(initialClient)
  // What the later steps were filled for; choosing another template or client starts them over.
  const [preparedFor, setPreparedFor] = useState('')
  const [title, setTitle] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [delivery, setDelivery] = useState<DeliveryType>('save')
  const [emailTo, setEmailTo] = useState('')
  const [message, setMessage] = useState('')
  const [signers, setSigners] = useState<DraftSigner[]>([])
  const [order, setOrder] = useState<SigningOrder>('parallel')
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const generate = useTemplateMutation((input: { id: string; body: GenerateRequest }) =>
    templatesApi.generate(input.id, input.body),
  )

  const state = { template, client, title, values, delivery, emailTo, signers }
  const problem = generateProblem(step, state)
  const dirty = preparedFor !== '' && step > 0

  const prepare = (chosen: Template, forClient: Client) => {
    const key = `${chosen.id}:${forClient.id}`
    if (key === preparedFor) return
    setPreparedFor(key)
    setTitle(`${chosen.name} – ${forClient.name}`)
    setValues(initialValues(chosen, forClient, new Date()))
    setDelivery(chosen.signers.length > 0 ? 'signature' : 'save')
    setEmailTo(primaryContact(forClient)?.email ?? forClient.email ?? '')
    setSigners(defaultSigners(chosen, forClient))
  }
  const next = () => {
    setTried(true)
    if (problem) return
    setTried(false)
    if (step === 0 && template && client) prepare(template, client)
    setStep(step + 1)
  }

  const send = () => {
    setTried(true)
    if (problem || !template || !client) return
    setServerError(null)
    const body: GenerateRequest = {
      client_id: client.id,
      title: title.trim(),
      values: valuesByField(template, values),
      delivery:
        delivery === 'email'
          ? { type: 'email', to: emailTo.trim().toLowerCase(), message: message.trim() || null }
          : delivery === 'signature'
            ? {
                type: 'signature',
                signers: signers.map((signer) => ({
                  name: signer.name.trim(),
                  email: signer.email.trim().toLowerCase(),
                })),
                message: message.trim() || null,
                signing_order: order,
                expires_in_days: 30,
              }
            : { type: 'save' },
    }
    generate.mutate(
      { id: template.id, body },
      {
        onSuccess: ({ data }) => {
          toast.success(
            data.signature_request_id
              ? `“${data.document.name}” sent for signature.`
              : data.emailed_to
                ? `“${data.document.name}” emailed to ${data.emailed_to}.`
                : `“${data.document.name}” saved to Documents.`,
          )
          onClose()
        },
        onError: (error) => setServerError(serverProblem(error)),
      },
    )
  }

  const draftFields = template ? toDraftFields(template) : []
  const caption = (field: TemplateDraftField) => {
    if (field.kind === 'signature' || field.kind === 'date' || field.kind === 'name')
      return fieldCaption({ ...field, kind: field.kind })
    if (field.kind === 'text') return field.label || 'Text'
    const value = step > 0 ? (values[valueKey({ id: field.key, kind: field.kind })] ?? '') : ''
    return value.trim() || (field.kind === 'custom' ? field.label : DATA_LABELS[field.kind])
  }
  const preview = (
    <DocPreview
      document={template?.document ?? null}
      fields={draftFields}
      caption={caption}
      pages={pages}
      onPages={setPages}
      empty="Choose a template to see it here."
    />
  )
  const actionLabel =
    delivery === 'signature'
      ? 'Send for signature'
      : delivery === 'email'
        ? 'Send email'
        : 'Save to Documents'

  return (
    <WizardSheet
      icon={<LayoutTemplate />}
      title={step > 0 && title.trim() ? title.trim() : 'New document from a template'}
      steps={STEPS}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={generate.isPending}
      discardTitle="Discard this document?"
      onClose={onClose}
      status={[template?.name ?? 'No template chosen', client?.name].filter(Boolean).join(' · ')}
      error={serverError ?? (tried ? problem : null)}
      action={
        step < STEPS.length - 1 ? (
          <Button className="cursor-pointer" onClick={next}>
            Next
          </Button>
        ) : (
          <Button className="cursor-pointer gap-1.5" disabled={generate.isPending} onClick={send}>
            {generate.isPending && <Loader2 className="size-4 animate-spin" />}
            {actionLabel}
          </Button>
        )
      }
    >
      {step === 0 && (
        <Split preview={preview}>
          <StepTitle
            title="Which template, for whom?"
            text="The client’s name, address and contact fill the template’s fields. You can check and change them next."
          />
          <TemplatePicker selected={template} onPick={setTemplate} />
          <ClientPicker selected={client} onPick={setClient} />
        </Split>
      )}
      {step === 1 && template && (
        <Split preview={preview}>
          <StepTitle
            title="Check the details"
            text="Taken from the client. Changes here go into this document only, not into the client’s record."
          />
          <FormField
            id="fill-title"
            label="Document title"
            required
            tip="Also its file name in Documents."
          >
            <Input
              id="fill-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <ValueFields
            template={template}
            values={values}
            tried={tried}
            onChange={(key, value) => setValues({ ...values, [key]: value })}
          />
        </Split>
      )}
      {step === 2 && template && (
        <Split preview={preview}>
          <StepTitle
            title="What should happen with it?"
            text="It is saved to Documents, next to the client’s other files, in every case."
          />
          <div className="grid gap-2">
            <Choice
              icon={FileDown}
              label="Save to Documents"
              text="Keep it; send it yourself later."
              selected={delivery === 'save'}
              onPick={() => setDelivery('save')}
            />
            <Choice
              icon={Mail}
              label="Email it to the client"
              text="As a PDF attachment, from your workspace."
              selected={delivery === 'email'}
              onPick={() => setDelivery('email')}
            />
            <Choice
              icon={FileSignature}
              label="Send for signature"
              text={
                template.signers.length > 0
                  ? 'Each signer gets a link to sign online.'
                  : 'This template has no signing fields. Add them in the template first.'
              }
              selected={delivery === 'signature'}
              disabled={template.signers.length === 0}
              onPick={() => setDelivery('signature')}
            />
          </div>
          {delivery === 'email' && (
            <FormField id="fill-to" label="To" required>
              <Input
                id="fill-to"
                type="email"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
              />
            </FormField>
          )}
          {delivery === 'signature' && (
            <RoleSigners
              template={template}
              signers={signers}
              onSigners={setSigners}
              order={order}
              onOrder={setOrder}
              tried={tried}
            />
          )}
          {delivery !== 'save' && (
            <FormField
              id="fill-message"
              label="Message"
              hint={
                delivery === 'signature' ? 'Shown in the email and on the signing page.' : undefined
              }
            >
              <Textarea
                id="fill-message"
                value={message}
                maxLength={2000}
                rows={4}
                placeholder="Hello, please find the document attached."
                onChange={(event) => setMessage(event.target.value)}
              />
            </FormField>
          )}
          {delivery === 'signature' && <SesLine />}
        </Split>
      )}
    </WizardSheet>
  )
}

const pickRow =
  'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-foreground/[0.04] aria-pressed:bg-brand-solid/[0.08]'

function TemplatePicker({
  selected,
  onPick,
}: {
  selected: Template | null
  onPick: (template: Template) => void
}) {
  const list = useTemplates()
  const templates = list.data ?? []
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">Template</h3>
      <div aria-label="Templates" className="grid max-h-64 overflow-y-auto rounded-xl border p-1">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            aria-pressed={template.id === selected?.id}
            onClick={() => onPick(template)}
            className={pickRow}
          >
            <LayoutTemplate className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px]">{template.name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {template.signers.length > 0 ? 'Asks for signatures' : 'No signatures'}
                {template.last_used_at && ` · used ${formatRelative(template.last_used_at)}`}
              </span>
            </span>
            {template.id === selected?.id && <Check className="size-4 text-brand" />}
          </button>
        ))}
        {templates.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {list.isPending ? 'Loading…' : 'No templates yet. Make one in Documents → Templates.'}
          </p>
        )}
      </div>
    </section>
  )
}

function ClientPicker({
  selected,
  onPick,
}: {
  selected: Client | null
  onPick: (client: Client) => void
}) {
  const [term, setTerm] = useState('')
  const search = useClientSearch(term)
  const clients = search.data?.data ?? []
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">Client</h3>
      <label className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-muted-foreground focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
        <Search className="size-4 shrink-0 stroke-[1.5]" />
        <input
          type="search"
          aria-label="Search clients"
          placeholder="Search clients"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-full bg-transparent text-[14px] text-foreground outline-none placeholder:text-placeholder"
        />
      </label>
      <div aria-label="Clients" className="grid max-h-64 overflow-y-auto rounded-xl border p-1">
        {selected && !clients.some((client) => client.id === selected.id) && (
          <ClientRow client={selected} selected onPick={() => {}} />
        )}
        {clients.map((client) => (
          <ClientRow
            key={client.id}
            client={client}
            selected={client.id === selected?.id}
            onPick={() => onPick(client)}
          />
        ))}
        {clients.length === 0 && !selected && (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {search.isPending ? 'Searching…' : 'No client matches.'}
          </p>
        )}
      </div>
    </section>
  )
}

function ClientRow({
  client,
  selected,
  onPick,
}: {
  client: Client
  selected: boolean
  onPick: () => void
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onPick} className={pickRow}>
      <Building2 className="size-4 shrink-0 stroke-[1.5] text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{client.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          #{client.number}
          {client.city && ` · ${client.city}`}
          {client.email && ` · ${client.email}`}
        </span>
      </span>
      {selected && <Check className="size-4 text-brand" />}
    </button>
  )
}

/** One input per kind of client data the template uses, and one per question it asks. */
function ValueFields({
  template,
  values,
  tried,
  onChange,
}: {
  template: Template
  values: Record<string, string>
  tried: boolean
  onChange: (key: string, value: string) => void
}) {
  const entries = template.fields
    .filter((field) => isDataKind(field.kind))
    .filter(
      (field, index, all) =>
        all.findIndex((other) => valueKey(other) === valueKey(field)) === index,
    )
  if (entries.length === 0)
    return (
      <p className="text-[13px] text-muted-foreground">
        This template has no client fields: the document is the PDF as it is.
      </p>
    )
  return (
    <div className="grid gap-4">
      {entries.map((field) => {
        const key = valueKey(field)
        const custom = field.kind === 'custom'
        const label = custom
          ? (field.label ?? 'Text')
          : isDataKind(field.kind)
            ? DATA_LABELS[field.kind]
            : ''
        const value = values[key] ?? ''
        const id = `fill-${key.replace(/\W/g, '-')}`
        return (
          <FormField
            key={key}
            id={id}
            label={label}
            required={custom}
            error={custom && tried && !value.trim() ? 'Fill this in.' : undefined}
            hint={
              !custom && !value.trim() ? 'The client has none: the box stays empty.' : undefined
            }
          >
            {field.kind === 'client.address' ? (
              <Textarea
                id={id}
                value={value}
                rows={2}
                onChange={(event) => onChange(key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={value}
                onChange={(event) => onChange(key, event.target.value)}
              />
            )}
          </FormField>
        )
      })}
    </div>
  )
}

function Choice({
  icon: Icon,
  label,
  text,
  selected,
  disabled,
  onPick,
}: {
  icon: LucideIcon
  label: string
  text: string
  selected: boolean
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-55 aria-pressed:border-brand-solid/60 aria-pressed:bg-brand-solid/[0.06]',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-muted-foreground" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[12.5px] text-muted-foreground">{text}</span>
      </span>
      {selected && <Check className="mt-0.5 size-4 text-brand" />}
    </button>
  )
}

/** The person behind each signing role, filled from the client where the role says so. */
function RoleSigners({
  template,
  signers,
  onSigners,
  order,
  onOrder,
  tried,
}: {
  template: Template
  signers: DraftSigner[]
  onSigners: (signers: DraftSigner[]) => void
  order: SigningOrder
  onOrder: (order: SigningOrder) => void
  tried: boolean
}) {
  const check = checkSigners(signers)
  const set = (index: number, change: Partial<DraftSigner>) =>
    onSigners(signers.map((signer, i) => (i === index ? { ...signer, ...change } : signer)))
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">Signers</h3>
      <ol className="grid gap-2">
        {template.signers.map((role, index) => {
          const signer = signers[index] ?? { name: '', email: '' }
          const row = check.rows[index]
          return (
            <li key={index} className="grid gap-2 rounded-xl border p-2.5">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: signerColor(index + ROLE_LANE) }}
                />
                {role.label}
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Input
                    aria-label={`${role.label} name`}
                    placeholder="Full name"
                    value={signer.name}
                    maxLength={200}
                    aria-invalid={tried && !!row?.name}
                    onChange={(event) => set(index, { name: event.target.value })}
                  />
                  {tried && row?.name && <p className="text-xs text-destructive">{row.name}</p>}
                </div>
                <div className="grid gap-1">
                  <Input
                    type="email"
                    aria-label={`${role.label} email`}
                    placeholder="name@company.ch"
                    value={signer.email}
                    aria-invalid={tried && !!row?.email}
                    onChange={(event) => set(index, { email: event.target.value })}
                  />
                  {tried && row?.email && <p className="text-xs text-destructive">{row.email}</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      {template.signers.length > 1 && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
          {(
            [
              ['parallel', 'Everyone at once'],
              ['sequential', 'One after another'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => onOrder(value)}
              className="h-8 cursor-pointer rounded-lg text-[13px] transition-colors aria-pressed:bg-card aria-pressed:font-medium aria-pressed:shadow-elevation-1"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
