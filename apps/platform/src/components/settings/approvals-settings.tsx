'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { Combobox } from '@helvetly/ui/components/combobox'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import {
  BadgeCheck,
  FileMinus,
  FilePen,
  FilePlus,
  FileText,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  UserX,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { UpsellCard } from '@/components/billing/upsell-card'
import { fieldErrors, FormDialog } from '@/components/invoices/invoice-dialogs'
import { apiFieldErrors, useSectionForm, type FieldErrors } from '@/components/section-form'
import { ApiError, errorMessage } from '@/lib/api'
import {
  DOC_TYPES,
  ruleSummary,
  useApprovalSettings,
  useDeleteGroup,
  useSaveGroup,
  useSavePolicy,
  type ApprovalGroup,
  type ApprovalPolicy,
  type ApprovalRule,
  type DocType,
} from '@/lib/approvals'
import { translate } from '@/lib/i18n'
import { formatAmount, parseDecimalInput } from '@/lib/invoices'
import { useMembers, type Member } from '@/lib/members'
import { useSession } from '@/lib/queries'

import { HelpTip } from './help-tip'
import {
  SettingsEmpty,
  SettingsPage,
  SettingsPreview,
  SettingsRow,
  SettingsSection,
} from './layout'
import { isManager, SettingsHeader } from './settings-tabs'

export const DOC_TYPE_INFO: Record<DocType, { label: string; hint: string; icon: LucideIcon }> = {
  invoice: {
    label: translate('invoices'),
    hint: translate('approvalInvoicesHint'),
    icon: FileText,
  },
  credit_note: {
    label: translate('creditNotes'),
    hint: translate('approvalCreditNotesHint'),
    icon: FileMinus,
  },
  debit_note: {
    label: translate('debitNotes'),
    hint: translate('approvalDebitNotesHint'),
    icon: FilePlus,
  },
  corrected: {
    label: translate('corrections'),
    hint: translate('approvalCorrectionsHint'),
    icon: FilePen,
  },
}

/** A policy as the form edits it: the threshold as typed. */
type Draft = { enabled: boolean; min_total: string; rules: ApprovalRule[] }
type Drafts = Record<DocType, Draft>

const ANYONE = 'anyone'
const FIRST_RULE: ApprovalRule = { group_id: null, min: 1 }

const draftOf = (policy: ApprovalPolicy | undefined): Draft => ({
  enabled: policy?.enabled ?? false,
  min_total: policy?.min_total ? formatAmount(policy.min_total) : '',
  rules: policy?.rules ?? [],
})

/** What the form can tell before asking the server, keyed `<doc type>.<field>`. */
export function policyProblems(drafts: Drafts): FieldErrors {
  const problems: FieldErrors = {}
  for (const type of DOC_TYPES) {
    const draft = drafts[type]
    if (!draft.enabled) continue
    if (draft.rules.length === 0) problems[`${type}.rules`] = translate('approvalAddARule')
    draft.rules.forEach((rule, i) => {
      if (!Number.isInteger(rule.min) || rule.min < 1)
        problems[`${type}.rules.${i}.min`] = translate('approvalAtLeastOne')
    })
    const total = draft.min_total.trim()
    if (total) {
      const amount = parseDecimalInput(total, 2)
      if (!amount || amount.startsWith('-') || Number(amount) === 0)
        problems[`${type}.min_total`] = translate('approvalEnterAnAmount')
    }
  }
  return problems
}

/** Settings → Approvals: approver groups, and per document type whether it needs approval before issuing. */
export function ApprovalsSettings() {
  const manager = isManager(useSession().data?.role)
  const lock = useFeatureLock('document_approvals')
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('approvals')}
        description={translate('approvalsPageDescription')}
      >
        {!manager ? (
          <SettingsEmpty icon={<ShieldCheck />} title={translate('approvalsManagersOnly')}>
            {translate('approvalsManagersOnlyBody')}
          </SettingsEmpty>
        ) : lock ? (
          <UpsellCard
            heading="h2"
            lock={lock}
            title={translate('approvalsUpsellTitle')}
            pitch={translate('approvalsUpsellPitch')}
            benefits={[
              { icon: Users, text: translate('approvalsBenefitGroups') },
              { icon: BadgeCheck, text: translate('approvalsBenefitRules') },
              { icon: ShieldCheck, text: translate('approvalsBenefitTrail') },
            ]}
          />
        ) : (
          <Approvals />
        )}
      </SettingsPage>
    </>
  )
}

function Approvals() {
  const settings = useApprovalSettings()
  const members = useMembers()
  if (settings.error)
    return <p className="text-body text-muted-foreground">{errorMessage(settings.error)}</p>
  if (!settings.data || !members.data) return <Loader className="min-h-64" />
  return (
    <>
      <Groups groups={settings.data.groups} members={members.data} />
      <Policies policies={settings.data.policies} groups={settings.data.groups} />
    </>
  )
}

// Groups

function Groups({ groups, members }: { groups: ApprovalGroup[]; members: Member[] }) {
  const [editing, setEditing] = useState<ApprovalGroup | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ApprovalGroup | null>(null)
  const remove = useDeleteGroup()
  const nameOf = (id: string) => members.find((member) => member.user_id === id)?.name
  const add = (
    <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
      <Plus />
      {translate('approvalNewGroup')}
    </Button>
  )
  return (
    <SettingsSection
      id="approval-groups"
      icon={Users}
      title={translate('approvalGroups')}
      description={translate('approvalGroupsDescription')}
      action={groups.length > 0 && add}
    >
      {groups.length === 0 ? (
        <SettingsEmpty icon={<Users />} title={translate('approvalNoGroups')} action={add}>
          {translate('approvalNoGroupsBody')}
        </SettingsEmpty>
      ) : (
        <ul className="grid max-w-[var(--settings-form,44rem)] divide-y">
          {groups.map((group) => {
            const names = group.member_ids.flatMap((id) => nameOf(id) ?? [])
            return (
              <SettingsRow
                key={group.id}
                icon={<Users />}
                title={group.name}
                meta={
                  names.length > 0
                    ? new Intl.ListFormat(languageTag, { type: 'conjunction' }).format(names)
                    : translate('approvalGroupEmpty')
                }
              >
                <IconAction
                  label={translate('approvalEditGroup', { name: group.name })}
                  tip={translate('approvalEditGroupTip')}
                  onClick={() => setEditing(group)}
                >
                  <Pencil />
                </IconAction>
                <IconAction
                  label={translate('approvalDeleteGroup', { name: group.name })}
                  tip={translate('approvalDeleteGroupTip')}
                  onClick={() => setDeleting(group)}
                >
                  <Trash2 />
                </IconAction>
              </SettingsRow>
            )
          })}
        </ul>
      )}
      {editing && (
        <GroupDialog
          group={editing === 'new' ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          tone="destructive"
          title={translate('approvalDeleteGroupTitle', { name: deleting.name })}
          body={translate('approvalDeleteGroupBody')}
          confirmLabel={translate('approvalDeleteGroupConfirm')}
          onDecide={(approved) => {
            const group = deleting
            setDeleting(null)
            if (approved)
              remove.mutate(group.id, {
                onSuccess: () => toast.success(translate('approvalGroupDeleted')),
                onError: (error) =>
                  error instanceof ApiError && error.code === 'group_in_use'
                    ? toast.error(translate('approvalGroupInUse', { name: group.name }))
                    : toastError(error),
              })
          }}
        />
      )}
    </SettingsSection>
  )
}

function IconAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string
  tip: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="text-muted-foreground"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Name the group and tick its members. */
function GroupDialog({
  group,
  members,
  onClose,
}: {
  group: ApprovalGroup | null
  members: Member[]
  onClose: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(group?.member_ids))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useSaveGroup()
  const submit = () => {
    if (!name.trim()) return setErrors({ name: translate('approvalEnterAGroupName') })
    save.mutate(
      {
        id: group?.id,
        name: name.trim(),
        // In the members' order, so the list reads the same as the team page.
        member_ids: members.map((member) => member.user_id).filter((id) => picked.has(id)),
      },
      {
        onSuccess: () => {
          toast.success(translate('approvalGroupSaved'))
          onClose()
        },
        onError: (error) => {
          const fields = fieldErrors(error)
          if (Object.keys(fields).length) setErrors(fields)
          else toastError(error)
        },
      },
    )
  }
  return (
    <FormDialog
      title={group ? translate('approvalEditGroupTitle') : translate('approvalNewGroupTitle')}
      description={translate('approvalGroupDialogDescription')}
      action={translate('approvalSaveGroup')}
      pending={save.isPending}
      onSubmit={submit}
      onClose={onClose}
    >
      <FormField id="approval-group-name" label={translate('name')} required error={errors.name}>
        <Input
          {...describedBy('approval-group-name', errors.name)}
          value={name}
          maxLength={80}
          placeholder={translate('approvalGroupNamePlaceholder')}
          onChange={(event) => {
            setName(event.target.value)
            setErrors({})
          }}
        />
      </FormField>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-body-sm font-medium">{translate('approvalMembers')}</legend>
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-lg border p-1">
          {members.map((member) => (
            <li key={member.user_id}>
              <label
                htmlFor={`approval-member-${member.user_id}`}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
              >
                <Checkbox
                  id={`approval-member-${member.user_id}`}
                  checked={picked.has(member.user_id)}
                  onCheckedChange={() =>
                    setPicked((current) => {
                      const next = new Set(current)
                      if (!next.delete(member.user_id)) next.add(member.user_id)
                      return next
                    })
                  }
                />
                <span className="grid min-w-0">
                  <span className="truncate text-sm">{member.name}</span>
                  <span className="truncate text-caption text-muted-foreground">
                    {member.email}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {errors.member_ids && <p className="text-body-sm text-destructive">{errors.member_ids}</p>}
      </fieldset>
    </FormDialog>
  )
}

// Policies

function Policies({ policies, groups }: { policies: ApprovalPolicy[]; groups: ApprovalGroup[] }) {
  const savePolicy = useSavePolicy()
  // The type being saved, so the server's field names land on its section.
  const saving = useRef<DocType>('invoice')
  const saved = (type: DocType) => draftOf(policies.find((policy) => policy.doc_type === type))
  const initial: Drafts = {
    invoice: saved('invoice'),
    credit_note: saved('credit_note'),
    debit_note: saved('debit_note'),
    corrected: saved('corrected'),
  }
  const form = useSectionForm<Drafts, DocType>({
    initial,
    sections: DOC_TYPES.map((type) => ({ id: type, fields: [type] })),
    validate: policyProblems,
    save: (values, type) => {
      saving.current = type
      const draft = values[type]
      const total = draft.min_total.trim()
      return savePolicy.mutateAsync({
        doc_type: type,
        enabled: draft.enabled,
        min_total: total ? parseDecimalInput(total, 2, true) : null,
        rules: draft.rules,
      })
    },
    fieldErrors: (error) => apiFieldErrors(error, (name) => `${saving.current}.${name}`),
    savedMessage: (type) => translate('approvalPolicySaved', { type: DOC_TYPE_INFO[type].label }),
  })
  const groupName = (id: string) => groups.find((group) => group.id === id)?.name
  return DOC_TYPES.map((type) => {
    const draft = form.values[type]
    const info = DOC_TYPE_INFO[type]
    const error = (field: string) => form.errors[`${type}.${field}`]
    const set = (change: Partial<Draft>) => form.set(type, { ...draft, ...change })
    const setRule = (i: number, change: Partial<ApprovalRule>) =>
      set({ rules: draft.rules.map((rule, at) => (at === i ? { ...rule, ...change } : rule)) })
    return (
      <SettingsSection
        key={type}
        id={`approval-policy-${type}`}
        icon={info.icon}
        title={info.label}
        description={info.hint}
        section={form.section(type)}
      >
        <div className="grid max-w-[var(--settings-form,44rem)] gap-4">
          <SwitchRow
            label={translate('approvalRequire')}
            description={translate('approvalRequireDescription')}
            checked={draft.enabled}
            onCheckedChange={(enabled) =>
              // Switched on with nothing set: one approval from anyone, the simplest rule.
              set({
                enabled,
                rules: enabled && draft.rules.length === 0 ? [FIRST_RULE] : draft.rules,
              })
            }
          />
          {draft.enabled && (
            <>
              <FormField
                id={`approval-min-${type}`}
                label={translate('approvalMinTotal')}
                width="sm"
                error={error('min_total')}
                hint={error('min_total') ? undefined : translate('approvalMinTotalHint')}
              >
                <Input
                  {...describedBy(`approval-min-${type}`, error('min_total'))}
                  inputMode="decimal"
                  placeholder="1'000.00"
                  value={draft.min_total}
                  onChange={(event) => set({ min_total: event.target.value })}
                  className="text-right tabular-nums"
                />
              </FormField>
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 flex items-center gap-1.5 text-body-sm font-medium">
                  {translate('approvalWhoApproves')}
                  <HelpTip label={translate('approvalWhoApproves')}>
                    {translate('approvalWhoApprovesHelp')}
                  </HelpTip>
                </legend>
                <ul className="grid gap-2">
                  {draft.rules.map((rule, i) => (
                    <RuleRow
                      // A source is picked once per policy, so it names its row.
                      key={rule.group_id ?? ANYONE}
                      id={`approval-rule-${type}-${i}`}
                      rule={rule}
                      groups={groups}
                      taken={draft.rules.flatMap((other) =>
                        other === rule ? [] : [other.group_id ?? ANYONE],
                      )}
                      minError={error(`rules.${i}.min`)}
                      groupError={error(`rules.${i}.group_id`)}
                      onChange={(change) => setRule(i, change)}
                      onRemove={() => set({ rules: draft.rules.filter((_, at) => at !== i) })}
                    />
                  ))}
                </ul>
                {error('rules') && (
                  <p role="alert" className="text-body-sm text-destructive">
                    {error('rules')}
                  </p>
                )}
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={nextSource(draft.rules, groups) === undefined}
                    onClick={() => {
                      const source = nextSource(draft.rules, groups)
                      if (source !== undefined)
                        set({ rules: [...draft.rules, { group_id: source, min: 1 }] })
                    }}
                  >
                    <Plus />
                    {translate('approvalAddRule')}
                  </Button>
                </div>
              </fieldset>
              {draft.rules.length > 0 && (
                <SettingsPreview label={translate('approvalSummaryLabel')}>
                  {[
                    ruleSummary(draft.rules, groupName),
                    translate('approvalAuthorNever'),
                    parseDecimalInput(draft.min_total, 2) &&
                      translate('approvalOnlyFrom', {
                        amount: formatAmount(parseDecimalInput(draft.min_total, 2, true) ?? ''),
                      }),
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </SettingsPreview>
              )}
            </>
          )}
        </div>
      </SettingsSection>
    )
  })
}

/** The first group (then "anyone") no rule asks yet; undefined when every source has its rule. */
export function nextSource(
  rules: readonly ApprovalRule[],
  groups: readonly ApprovalGroup[],
): string | null | undefined {
  const used = new Set(rules.map((rule) => rule.group_id))
  return [...groups.map((group) => group.id), null].find((source) => !used.has(source))
}

function RuleRow({
  id,
  rule,
  groups,
  taken,
  minError,
  groupError,
  onChange,
  onRemove,
}: {
  id: string
  rule: ApprovalRule
  groups: ApprovalGroup[]
  /** Sources the other rows ask already: each is picked once. */
  taken: string[]
  minError?: string
  groupError?: string
  onChange: (change: Partial<ApprovalRule>) => void
  onRemove: () => void
}) {
  const options = [
    ...groups.map((group) => ({
      value: group.id,
      label: group.name,
      hint: translate('approvalGroupSize', { count: group.member_ids.length }),
    })),
    { value: ANYONE, label: translate('approvalAnyoneOption') },
  ].filter((option) => !taken.includes(option.value))
  const problem = groupError ?? minError
  return (
    <li data-testid="approval-rule" className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          id={`${id}-group`}
          label={translate('approvalRuleGroup')}
          value={rule.group_id ?? ANYONE}
          options={options}
          invalid={Boolean(groupError)}
          placeholder={translate('approvalPickGroup')}
          className="min-w-0 flex-1 basis-56"
          onChange={(value) => onChange({ group_id: value === ANYONE ? null : value })}
        />
        <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
          <label htmlFor={`${id}-min`}>{translate('approvalAtLeast')}</label>
          <Input
            id={`${id}-min`}
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={Number.isNaN(rule.min) ? '' : rule.min}
            aria-invalid={Boolean(minError) || undefined}
            aria-describedby={problem ? `${id}-error` : undefined}
            onChange={(event) => onChange({ min: event.target.valueAsNumber })}
            className="w-20 text-right tabular-nums"
          />
          <span>{translate('approvalApprovals', { count: rule.min || 0 })}</span>
        </span>
        <IconAction
          label={translate('approvalRemoveRule')}
          tip={translate('approvalRemoveRule')}
          onClick={onRemove}
        >
          <X />
        </IconAction>
      </div>
      {problem && (
        <p id={`${id}-error`} className="text-body-sm text-destructive">
          {problem}
        </p>
      )}
      {rule.group_id !== null &&
        groups.find((group) => group.id === rule.group_id)?.member_ids.length === 0 && (
          <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <UserX aria-hidden className="size-3.5" />
            {translate('approvalGroupHasNoMembers')}
          </p>
        )}
    </li>
  )
}
