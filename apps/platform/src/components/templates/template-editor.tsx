'use client'

import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Textarea } from '@helvetly/ui/components/textarea'
import { LayoutTemplate, Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/clients/fields'
import { serverProblem } from '@/components/signatures/create-drawer'
import { SesLine } from '@/components/signatures/parts'
import { DocPreview, PdfPicker } from '@/components/signatures/pdf-parts'
import { Placement } from '@/components/signatures/placement'
import { Split, StepTitle, WizardSheet } from '@/components/wizard-sheet'
import { contentUrl } from '@/lib/documents'
import { dropSigner, signerColor, titleFromName } from '@/lib/signatures'
import {
  buildTemplateBody,
  templateProblem,
  templatesApi,
  toDraftFields,
  useTemplateMutation,
  type SignerRole,
  type Template,
  type TemplateDraftField,
  type TemplateInput,
  ROLE_LANE,
} from '@/lib/templates'

import { kindLabel, templatePalette } from './parts'

const STEPS = ['Document', 'Signing', 'Place fields'] as const

/** A role row in the editor: `id` keeps its identity through edits and removals; never sent. */
type RoleRow = SignerRole & { id: string }
const roleRow = (role: SignerRole): RoleRow => ({ ...role, id: crypto.randomUUID() })
const FIRST_ROLES: SignerRole[] = [{ label: 'Client', fill: 'client' }]

const caption = (field: TemplateDraftField) =>
  (field.kind === 'text' || field.kind === 'custom') && field.label
    ? field.label
    : kindLabel(field.kind)

/**
 * Make or change a template: the PDF it is built on, who signs (optional), and where the client's
 * data and the signatures go.
 */
export function TemplateEditor({
  template,
  initialDocument,
  folderId,
  onClose,
  onSaved,
}: {
  /** The template to change; null makes a new one. */
  template: Template | null
  /** A new template's PDF, when started from a file's menu. */
  initialDocument: { id: string; name: string } | null
  folderId: string | null
  onClose: () => void
  onSaved: (template: Template) => void
}) {
  const startDocument = template?.document ?? initialDocument
  const [step, setStep] = useState(startDocument ? (template ? 2 : 1) : 0)
  const [name, setName] = useState(
    template?.name ?? (initialDocument ? titleFromName(initialDocument.name) : ''),
  )
  const [description, setDescription] = useState(template?.description ?? '')
  const [document, setDocument] = useState(startDocument)
  const [signing, setSigning] = useState((template?.signers.length ?? 0) > 0)
  const [roles, setRoles] = useState(() =>
    (template?.signers.length ? template.signers : FIRST_ROLES).map(roleRow),
  )
  const [fields, setFields] = useState<TemplateDraftField[]>(
    template ? toDraftFields(template) : [],
  )
  const [active, setActive] = useState(0)
  const [pages, setPages] = useState(0)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const save = useTemplateMutation((body: TemplateInput) =>
    template ? templatesApi.update(template.id, body) : templatesApi.create(body),
  )

  // Turning signing off keeps the signing fields aside, so turning it back on restores them.
  const signers = signing ? roles : []
  const placed = signing ? fields : fields.filter((field) => field.signer < ROLE_LANE)
  const state = { name, document, signers, fields: placed }
  const problem = templateProblem(step, state)
  const draft = buildTemplateBody({
    name,
    description,
    documentId: document?.id ?? '',
    signers: signers.map(({ label, fill }) => ({ label, fill })),
    fields: placed,
  })
  const [initial] = useState(() => JSON.stringify(draft))
  const dirty = JSON.stringify(draft) !== initial

  const next = () => {
    setTried(true)
    if (problem) return
    setTried(false)
    setStep(step + 1)
  }
  const finish = () => {
    setTried(true)
    // Any step's gap stops the save, and the editor goes to it.
    const gap = [0, 1, 2].find((index) => templateProblem(index, state))
    if (gap !== undefined) return setStep(gap)
    setServerError(null)
    save.mutate(draft, {
      onSuccess: ({ data }) => {
        toast.success(template ? 'Template saved.' : `Template “${data.name}” created.`)
        onSaved(data)
      },
      onError: (error) => setServerError(serverProblem(error)),
    })
  }

  const summary = [
    document?.name ?? 'No PDF chosen yet',
    signing && `${signers.length} ${signers.length === 1 ? 'signer' : 'signers'}`,
    placed.length > 0 && `${placed.length} ${placed.length === 1 ? 'field' : 'fields'}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const palette = templatePalette(signers)
  const preview = (
    <DocPreview
      document={document}
      fields={placed}
      caption={caption}
      pages={pages}
      onPages={setPages}
    />
  )

  return (
    <WizardSheet
      icon={<LayoutTemplate />}
      title={name.trim() || 'New template'}
      steps={STEPS}
      step={step}
      onStep={setStep}
      dirty={dirty}
      busy={save.isPending}
      discardTitle={template ? 'Discard your changes?' : 'Discard this template?'}
      onClose={onClose}
      status={summary}
      error={serverError ?? (tried ? problem : null)}
      action={
        step < STEPS.length - 1 ? (
          <div className="flex gap-2">
            {template && (
              <Button
                variant="ghost"
                className="cursor-pointer"
                disabled={save.isPending}
                onClick={finish}
              >
                Save
              </Button>
            )}
            <Button className="cursor-pointer" onClick={next}>
              Next
            </Button>
          </div>
        ) : (
          <Button className="cursor-pointer gap-1.5" disabled={save.isPending} onClick={finish}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {template ? 'Save template' : 'Create template'}
          </Button>
        )
      }
    >
      {step === 0 && (
        <Split preview={preview}>
          <StepTitle
            title="What is the template built on?"
            text="A PDF from Documents: a contract, an offer, a letter. Made in Word or Google Docs? Download it as PDF first. You place the client’s details on it next."
          />
          <PdfPicker
            document={document}
            folderId={folderId}
            onChoose={(file) => {
              if (file.id !== document?.id) setFields([])
              if (!name.trim() || name === titleFromName(document?.name ?? ''))
                setName(titleFromName(file.name))
              setDocument(file)
            }}
          />
          <FormField
            id="tpl-name"
            label="Name"
            required
            error={tried && !name.trim() ? 'Enter a name.' : undefined}
          >
            <Input
              id="tpl-name"
              value={name}
              maxLength={200}
              placeholder="e.g. Consulting agreement"
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField id="tpl-description" label="Description" hint="Only you and your team see it.">
            <Textarea
              id="tpl-description"
              value={description}
              maxLength={500}
              rows={3}
              placeholder="When to use it and what to check before sending"
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
        </Split>
      )}
      {step === 1 && (
        <Split preview={preview}>
          <StepTitle
            title="Does it need signatures?"
            text="A document made from the template can simply be saved or emailed. Ask for signatures, and it goes out to sign online instead."
          />
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
            {(
              [
                [false, 'No signatures', 'Fill in, then save or email it.'],
                [true, 'Ask for signatures', 'Fill in, then send it to sign online.'],
              ] as const
            ).map(([value, label, text]) => (
              <button
                key={label}
                type="button"
                aria-pressed={signing === value}
                onClick={() => {
                  setSigning(value)
                  setActive(0)
                }}
                className="grid cursor-pointer gap-0.5 rounded-lg px-3 py-2 text-left transition-colors aria-pressed:bg-card aria-pressed:shadow-elevation-1"
              >
                <span className="text-[13.5px] font-medium">{label}</span>
                <span className="text-[12px] text-muted-foreground">{text}</span>
              </button>
            ))}
          </div>
          {signing && (
            <RolesEditor
              roles={roles}
              tried={tried}
              onRoles={setRoles}
              onRemove={(index) => {
                setRoles(roles.filter((_, i) => i !== index))
                setFields(dropSigner(fields, index + ROLE_LANE))
                setActive(0)
              }}
            />
          )}
          {signing && <SesLine />}
        </Split>
      )}
      {step === 2 && document && (
        <Placement
          src={contentUrl(document.id)}
          title={document.name}
          palette={palette}
          fields={placed}
          onFields={(changed) =>
            setFields(
              signing
                ? changed
                : [...changed, ...fields.filter((field) => field.signer >= ROLE_LANE)],
            )
          }
          active={Math.min(active, palette.lanes.length - 1)}
          onActive={setActive}
          onPages={setPages}
        />
      )}
    </WizardSheet>
  )
}

/** The signing roles: what each is called, and who fills it when a document is sent. */
function RolesEditor({
  roles,
  tried,
  onRoles,
  onRemove,
}: {
  roles: RoleRow[]
  tried: boolean
  onRoles: (roles: RoleRow[]) => void
  onRemove: (index: number) => void
}) {
  const set = (index: number, change: Partial<SignerRole>) =>
    onRoles(roles.map((role, i) => (i === index ? { ...role, ...change } : role)))
  return (
    <section className="grid gap-2">
      <h3 className="text-[13px] font-medium">Who signs</h3>
      <ol className="grid gap-2">
        {roles.map((role, index) => (
          <li key={role.id} className="flex items-start gap-2 rounded-xl border p-2.5">
            <span
              className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white tabular-nums"
              // Role n is drawn in its lane's colour.
              style={{ backgroundColor: signerColor(index + ROLE_LANE) }}
            >
              {index + 1}
            </span>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Input
                  aria-label={`Signer ${index + 1} role`}
                  placeholder="Role, e.g. Client"
                  value={role.label}
                  maxLength={60}
                  aria-invalid={tried && !role.label.trim()}
                  onChange={(event) => set(index, { label: event.target.value })}
                />
              </div>
              <NativeSelect
                aria-label={`Who signs as ${role.label || `signer ${index + 1}`}`}
                value={role.fill}
                onChange={(event) =>
                  set(index, { fill: event.target.value === 'client' ? 'client' : 'manual' })
                }
              >
                <option value="client">The client’s contact</option>
                <option value="manual">Chosen when sending</option>
              </NativeSelect>
            </div>
            <Button
              variant="destructive-ghost"
              size="icon-sm"
              aria-label={`Remove signer ${index + 1}`}
              disabled={roles.length === 1}
              className="mt-0.5 cursor-pointer"
              onClick={() => onRemove(index)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          className="cursor-pointer gap-1.5"
          disabled={roles.length >= 10}
          onClick={() => onRoles([...roles, roleRow({ label: '', fill: 'manual' })])}
        >
          <Plus className="size-4" /> Add signer
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        The client’s contact is filled from the client you make the document for; you can change it
        before sending.
      </p>
    </section>
  )
}
