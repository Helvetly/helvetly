'use client'
import { ActionMenuContent, type ActionMenuSpec } from '@helvetly/ui/components/action-menu'
import { Badge, TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Combobox, type Option } from '@helvetly/ui/components/combobox'
import { ContextMenu, ContextMenuTrigger } from '@helvetly/ui/components/context-menu'
import { DropdownMenu, DropdownMenuTrigger } from '@helvetly/ui/components/dropdown-menu'
import { FormField } from '@helvetly/ui/components/form-field'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Input } from '@helvetly/ui/components/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@helvetly/ui/components/input-group'
import { Loader } from '@helvetly/ui/components/loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { Switch } from '@helvetly/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Archive,
  ArchiveRestore,
  Briefcase,
  Building2,
  Car,
  Ellipsis,
  Info,
  Landmark,
  Megaphone,
  Package,
  Pencil,
  Plus,
  Search,
  Shapes,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import {
  categoryGroupKey,
  categoryLabel,
  CHART_ACCOUNTS,
  GROUP_KEYS,
  GROUP_LABELS,
  isAccountNumber,
  treatmentRate,
  VAT_BADGE_LABELS,
  vatBadge,
  type CategoryGroupKey,
} from '@/lib/expense-categories'
import {
  useAllExpenseCategories,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  type CategoryUpdate,
  type ExpenseCategory,
  type VatTreatment,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { today } from '@/lib/invoices'

/** Each group's icon, tile and row accent: soft tints on the theme's tokens, so dark mode follows. */
const GROUP_STYLE: Record<CategoryGroupKey, { icon: LucideIcon; tile: string; accent: string }> = {
  goods: { icon: Package, tile: TONES.blue, accent: 'bg-info-solid' },
  staff: { icon: Users, tile: TONES.violet, accent: 'bg-violet-solid' },
  premises: { icon: Building2, tile: TONES.amber, accent: 'bg-warning-solid' },
  vehicles: { icon: Car, tile: TONES.green, accent: 'bg-success-solid' },
  insurance: { icon: ShieldCheck, tile: 'bg-brand-surface text-brand', accent: 'bg-brand-solid' },
  administration: { icon: Briefcase, tile: 'bg-chart-3/15 text-chart-3', accent: 'bg-chart-3' },
  marketing: { icon: Megaphone, tile: TONES.red, accent: 'bg-destructive/60' },
  finance: {
    icon: Landmark,
    tile: 'bg-chart-5/20 text-(--plan-business)',
    accent: 'bg-chart-5',
  },
  other: { icon: Shapes, tile: TONES.neutral, accent: 'bg-muted-foreground/40' },
}

const VAT_TONE: Record<VatTreatment, Tone> = {
  standard: 'blue',
  reduced: 'green',
  lodging: 'violet',
  exempt: 'amber',
  none: 'neutral',
}

const VAT_TREATMENTS = Object.keys(VAT_TONE) as VatTreatment[]

/** Matches a category by its shown name, its stored one or its account code. */
function matches(category: ExpenseCategory, query: string) {
  const term = query.trim().toLowerCase()
  if (!term) return true
  return [categoryLabel(category), category.name, category.account_code].some((text) =>
    text.toLowerCase().includes(term),
  )
}

/** The workspace's expense categories under their account groups; owners and admins add and edit them here. */
export function ExpenseCategoriesSheet({ onClose }: { onClose: () => void }) {
  const categories = useAllExpenseCategories()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // A category's id, or 'new' for the add form at the top.
  const [editing, setEditing] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 2500)
    return () => clearTimeout(timer)
  }, [highlight])

  const list = categories.data ?? []
  const shown = list.filter((c) => (showArchived || !c.is_archived) && matches(c, query))
  const groups = GROUP_KEYS.map((key) => {
    const rows = shown.filter((c) => categoryGroupKey(c.account_code) === key)
    // Active ones first; the API's account order within each.
    return [key, rows.toSorted((a, b) => Number(a.is_archived) - Number(b.is_archived))] as const
  }).filter(([, rows]) => rows.length > 0)
  const byAccount = new Map<string, string[]>()
  for (const c of list.filter((entry) => !entry.is_archived))
    byAccount.set(c.account_code, [...(byAccount.get(c.account_code) ?? []), categoryLabel(c)])
  const alsoUsedBy = (c: ExpenseCategory) =>
    (byAccount.get(c.account_code) ?? []).filter((name) => name !== categoryLabel(c))

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full! max-w-none! gap-0 p-0 sm:w-[640px]!">
        <SheetHeader className="border-b px-5 py-4 md:px-6">
          <SheetTitle>{translate('expenseCategories')}</SheetTitle>
          <SheetDescription>{translate('expenseCategoriesDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-5 py-3 md:px-6">
          <InputGroup className="min-w-48 flex-1">
            <InputGroupInput
              type="search"
              aria-label={translate('searchCategories')}
              placeholder={translate('searchCategories')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
          </InputGroup>
          <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} />
            {translate('showArchived')}
          </label>
          <Button type="button" onClick={() => setEditing('new')} disabled={!categories.data}>
            <Plus />
            {translate('addCategory')}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6 md:px-6">
          {editing === 'new' && (
            <div className="mt-4 rounded-xl border bg-card p-4">
              <CategoryForm
                categories={list}
                onDone={(created) => {
                  setEditing(null)
                  if (!created) return
                  setQuery('')
                  setHighlight(created.id)
                }}
              />
            </div>
          )}
          {categories.error ? (
            <p role="alert" className="py-6 text-body text-muted-foreground">
              {errorMessage(categories.error)}
            </p>
          ) : !categories.data ? (
            <Loader className="py-10" />
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-body-sm text-muted-foreground">
              {translate('noCategoriesMatch')}
            </p>
          ) : (
            groups.map(([key, rows]) => (
              <section key={key} aria-labelledby={`category-group-${key}`} className="pt-2">
                <GroupHeader group={key} count={rows.length} />
                <ul className="grid gap-1 pb-3">
                  {rows.map((category) =>
                    editing === category.id ? (
                      <li key={category.id} className="rounded-xl border bg-card p-4">
                        <CategoryForm
                          category={category}
                          categories={list}
                          onDone={() => setEditing(null)}
                        />
                      </li>
                    ) : (
                      <CategoryRow
                        key={category.id}
                        category={category}
                        group={key}
                        alsoUsedBy={alsoUsedBy(category)}
                        highlighted={highlight === category.id}
                        onEdit={() => setEditing(category.id)}
                      />
                    ),
                  )}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function GroupHeader({ group, count }: { group: CategoryGroupKey; count: number }) {
  const style = GROUP_STYLE[group]
  return (
    // Stays in view while its categories scroll under it.
    <div className="sticky top-0 z-10 -mx-5 flex items-center gap-3 bg-popover/95 px-5 py-2.5 backdrop-blur-sm md:-mx-6 md:px-6">
      <IconTile icon={style.icon} size="sm" className={style.tile} />
      <h3 id={`category-group-${group}`} className="text-body-sm font-medium">
        {GROUP_LABELS[group]()}
      </h3>
      <span className="text-caption text-muted-foreground tabular-nums">
        {translate('categoryCount', { count })}
      </span>
    </div>
  )
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CategoryRow({
  category,
  group,
  alsoUsedBy,
  highlighted,
  onEdit,
}: {
  category: ExpenseCategory
  group: CategoryGroupKey
  alsoUsedBy: string[]
  highlighted: boolean
  onEdit: () => void
}) {
  const update = useUpdateExpenseCategory()
  const label = categoryLabel(category)
  const archived = category.is_archived
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (highlighted) row.current?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])
  const toggleArchived = () =>
    update.mutate(
      { id: category.id, input: { is_archived: !archived } },
      { onError: (error) => toast.error(errorMessage(error)) },
    )
  const menu: ActionMenuSpec = {
    header: `${category.account_code} · ${label}`,
    actions: [
      { id: 'edit', group: 'edit', label: translate('edit'), icon: <Pencil />, onSelect: onEdit },
      archived
        ? {
            id: 'unarchive',
            group: 'edit',
            label: translate('unarchive'),
            icon: <ArchiveRestore />,
            disabled: update.isPending,
            onSelect: toggleArchived,
          }
        : {
            id: 'archive',
            group: 'danger',
            label: translate('archive'),
            icon: <Archive />,
            disabled: update.isPending,
            onSelect: toggleArchived,
          },
    ],
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={row}
          data-highlighted={highlighted || undefined}
          className={cn(
            'group/row relative flex min-h-16 items-center gap-3 rounded-lg py-2.5 pr-2 pl-4 transition-colors duration-700 hover:bg-muted/50',
            highlighted && 'bg-info-surface hover:bg-info-surface',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-3 left-1 w-0.75 rounded-full',
              GROUP_STYLE[group].accent,
              archived && 'opacity-40',
            )}
          />
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'truncate text-body-sm font-medium',
                  archived && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {archived && (
                <Badge size="sm" variant="outline">
                  {translate('archived')}
                </Badge>
              )}
            </span>
            <CategoryFacts category={category} alsoUsedBy={alsoUsedBy} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Quiet until the row is hovered or focused; phones use the "…" menu. */}
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 max-sm:hidden">
              <IconAction label={translate('edit')} onClick={onEdit}>
                <Pencil />
              </IconAction>
              <IconAction
                label={archived ? translate('unarchive') : translate('archive')}
                disabled={update.isPending}
                onClick={toggleArchived}
              >
                {archived ? <ArchiveRestore /> : <Archive />}
              </IconAction>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('moreActions')}
                  className="text-muted-foreground"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <ActionMenuContent kind="dropdown" menu={menu} />
            </DropdownMenu>
          </div>
        </li>
      </ContextMenuTrigger>
      <ActionMenuContent kind="context" menu={menu} />
    </ContextMenu>
  )
}

/** "Account 6640 · Standard 8.1% · 2 expenses": the account as a code pill, the VAT as a tinted badge. */
function CategoryFacts({
  category,
  alsoUsedBy,
}: {
  category: ExpenseCategory
  alsoUsedBy: string[]
}) {
  const shared = translate('categoryAlsoUsedBy', { names: alsoUsedBy.join(', ') })
  const dot = <span aria-hidden>·</span>
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
      <span className="flex items-center gap-1">
        {translate('account')}
        <code className="rounded-md bg-muted px-1.5 font-mono text-caption text-foreground/80 tabular-nums">
          {category.account_code}
        </code>
        {alsoUsedBy.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={shared}
                className="inline-flex rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{shared}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {dot}
      {category.vat_treatment ? (
        <Badge size="sm" tone={VAT_TONE[category.vat_treatment]} data-vat={category.vat_treatment}>
          {vatBadge(category.vat_treatment, today())}
        </Badge>
      ) : (
        <Badge size="sm" variant="outline">
          {translate('vatBadgeUnset')}
        </Badge>
      )}
      {dot}
      <span className={cn('tabular-nums', category.expenses_count > 0 && 'text-foreground')}>
        {translate('importExpenseCount', { count: category.expenses_count })}
      </span>
    </span>
  )
}

export type CategoryDraft = { name: string; account: string; vat: VatTreatment | '' }

/** Changes only what was changed: an untouched translated name is never sent back, so the category stays a preset. */
export function categoryChanges(
  category: Pick<ExpenseCategory, 'name' | 'preset' | 'account_code' | 'vat_treatment'>,
  draft: CategoryDraft,
): CategoryUpdate {
  const changes: CategoryUpdate = {}
  if (draft.name.trim() !== categoryLabel(category)) changes.name = draft.name.trim()
  if (draft.account.trim() !== category.account_code) changes.account_code = draft.account.trim()
  if (draft.vat && draft.vat !== category.vat_treatment) changes.vat_treatment = draft.vat
  return changes
}

/** What is wrong with a draft before it is sent; the API checks again. */
export function draftErrors(
  draft: CategoryDraft,
  categories: ExpenseCategory[],
  category?: ExpenseCategory,
): FieldErrors {
  const errors: FieldErrors = {}
  const name = draft.name.trim().toLowerCase()
  if (!name) errors.name = translate('categoryNameRequired')
  // Archived ones too: a name stays taken while its category is kept.
  else if (
    categories.some(
      (other) =>
        other.id !== category?.id &&
        (other.name.toLowerCase() === name || categoryLabel(other).toLowerCase() === name),
    )
  )
    errors.name = translate('categoryNameTaken')
  const account = draft.account.trim()
  if (account !== category?.account_code && !isAccountNumber(account))
    errors.account_code = translate('accountFourDigits')
  return errors
}

/** The SME chart's accounts under their groups, plus a number the category already has. */
function accountOptions(group: CategoryGroupKey, extra: string): Option[] {
  const codes = Object.keys(CHART_ACCOUNTS)
  if (extra && !codes.includes(extra)) codes.push(extra)
  return codes
    .toSorted()
    .filter((code) => group === 'other' || categoryGroupKey(code) === group)
    .map((code) => ({
      value: code,
      label: `${code} · ${CHART_ACCOUNTS[code]?.() ?? translate('accountCode')}`,
      group: GROUP_LABELS[categoryGroupKey(code)](),
    }))
}

/** Adds a category (without `category`) or edits one, in place: name, group, account and default VAT rate. */
function CategoryForm({
  category,
  categories,
  onDone,
}: {
  category?: ExpenseCategory
  categories: ExpenseCategory[]
  onDone: (created?: ExpenseCategory) => void
}) {
  const create = useCreateExpenseCategory()
  const update = useUpdateExpenseCategory()
  const [draft, setDraft] = useState<CategoryDraft>(() => ({
    name: category ? categoryLabel(category) : '',
    account: category?.account_code ?? '',
    vat: category ? (category.vat_treatment ?? '') : 'standard',
  }))
  const [group, setGroup] = useState<CategoryGroupKey>(() =>
    category ? categoryGroupKey(category.account_code) : 'other',
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const id = `category-${category?.id ?? 'new'}`
  // The row's Edit button (or Add category) is gone or behind; the name takes the focus.
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => nameField.current?.focus(), [])
  const date = today()
  const pending = create.isPending || update.isPending
  const failed = (error: Parameters<typeof apiFieldErrors>[0]) => {
    const fields = apiFieldErrors(error)
    if (fields) setErrors(fields)
    else toast.error(errorMessage(error))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = draftErrors(draft, categories, category)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (!category)
      return create.mutate(
        {
          name: draft.name.trim(),
          account_code: draft.account.trim(),
          ...(draft.vat && { vat_treatment: draft.vat }),
        },
        { onSuccess: (made) => onDone(made), onError: failed },
      )
    const input = categoryChanges(category, draft)
    if (Object.keys(input).length === 0) return onDone()
    update.mutate({ id: category.id, input }, { onSuccess: () => onDone(), onError: failed })
  }
  const pickAccount = (account: string) => {
    setDraft((d) => ({ ...d, account }))
    setGroup(categoryGroupKey(account))
    setErrors((e) => ({ ...e, account_code: undefined }))
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={category ? translate('edit') : translate('addCategory')}
      className="grid gap-3 sm:grid-cols-2"
    >
      <FormField
        id={`${id}-name`}
        label={translate('categoryName')}
        required
        error={errors.name}
        hint={category?.preset ? translate('renamingKeepsYourName') : undefined}
        className="sm:col-span-2"
      >
        <Input
          ref={nameField}
          id={`${id}-name`}
          value={draft.name}
          aria-invalid={Boolean(errors.name) || undefined}
          onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
        />
      </FormField>
      <FormField id={`${id}-group`} label={translate('categoryGroupField')}>
        <Combobox
          id={`${id}-group`}
          value={group}
          placeholder={translate('categoryGroupField')}
          options={GROUP_KEYS.map((key) => ({ value: key, label: GROUP_LABELS[key]() }))}
          onChange={(value) => {
            const next = GROUP_KEYS.find((key) => key === value) ?? 'other'
            setGroup(next)
            // An account of another group would put the category there; choose again.
            setDraft((d) =>
              next === 'other' || categoryGroupKey(d.account) === next ? d : { ...d, account: '' },
            )
          }}
        />
      </FormField>
      <FormField
        id={`${id}-account`}
        label={translate('accountCode')}
        required
        tip={translate('accountCodeTip')}
        error={errors.account_code}
      >
        <Combobox
          id={`${id}-account`}
          value={draft.account}
          invalid={Boolean(errors.account_code)}
          placeholder={translate('chooseAccount')}
          searchable
          options={accountOptions(group, draft.account)}
          onChange={pickAccount}
          createLabel={translate('useAccountNumber')}
          onCreate={(term) => {
            const account = term.trim()
            if (isAccountNumber(account)) pickAccount(account)
            else setErrors((e) => ({ ...e, account_code: translate('accountFourDigits') }))
          }}
        />
      </FormField>
      <FormField
        id={`${id}-vat`}
        label={translate('defaultVatRate')}
        error={errors.vat_treatment}
        className="sm:col-span-2"
      >
        <Combobox
          id={`${id}-vat`}
          value={draft.vat}
          placeholder={translate('vatBadgeUnset')}
          options={VAT_TREATMENTS.map((treatment) => {
            const rate = treatmentRate(treatment, date)
            return {
              value: treatment,
              label: VAT_BADGE_LABELS[treatment](),
              hint: rate && rate !== '0' ? `${rate}%` : undefined,
            }
          })}
          onChange={(value) =>
            setDraft((d) => ({ ...d, vat: VAT_TREATMENTS.find((t) => t === value) ?? '' }))
          }
        />
      </FormField>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {translate('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {category ? translate('saveChanges') : translate('saveCategory')}
        </Button>
      </div>
    </form>
  )
}
