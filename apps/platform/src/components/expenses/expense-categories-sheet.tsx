'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { Archive, ArchiveRestore, Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { inputClass } from '@/components/clients/fields'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { errorMessage } from '@/lib/api'
import {
  categoryGroup,
  categoryLabel,
  treatmentRate,
  VAT_TREATMENT_LABELS,
} from '@/lib/expense-categories'
import {
  useAllExpenseCategories,
  useUpdateExpenseCategory,
  type CategoryUpdate,
  type ExpenseCategory,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { today } from '@/lib/invoices'

/** The workspace's expense categories under their account headings, archived ones last; owners and admins edit them here. */
export function ExpenseCategoriesSheet({ onClose }: { onClose: () => void }) {
  const categories = useAllExpenseCategories()
  const [editing, setEditing] = useState<string | null>(null)
  const list = categories.data ?? []
  const sections = new Map<string, ExpenseCategory[]>()
  for (const category of list) {
    const heading = category.is_archived
      ? translate('archived')
      : categoryGroup(category.account_code)
    sections.set(heading, [...(sections.get(heading) ?? []), category])
  }
  // Archived ones last, the rest in account order (the API's).
  const archived = translate('archived')
  const ordered = [...sections].toSorted(
    ([a], [b]) => Number(a === archived) - Number(b === archived),
  )

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full! max-w-none! gap-0 p-0 sm:w-[640px]!">
        <SheetHeader className="border-b px-5 py-4 md:px-6">
          <SheetTitle>{translate('expenseCategories')}</SheetTitle>
          <SheetDescription>{translate('expenseCategoriesDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 md:px-6">
          {categories.error ? (
            <p role="alert" className="text-body text-muted-foreground">
              {errorMessage(categories.error)}
            </p>
          ) : !categories.data ? (
            <Loader className="py-10" />
          ) : (
            ordered.map(([heading, rows]) => (
              <section key={heading} className="grid gap-1 pb-4">
                <h3 className="text-caption font-medium text-muted-foreground">{heading}</h3>
                <ul className="grid divide-y divide-border/60">
                  {rows.map((category) =>
                    editing === category.id ? (
                      <li key={category.id} className="py-2">
                        <CategoryEditor category={category} onDone={() => setEditing(null)} />
                      </li>
                    ) : (
                      <CategoryRow
                        key={category.id}
                        category={category}
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

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
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
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CategoryRow({ category, onEdit }: { category: ExpenseCategory; onEdit: () => void }) {
  const update = useUpdateExpenseCategory()
  const label = categoryLabel(category)
  const rate = treatmentRate(category.vat_treatment, today())
  const toggleArchived = () =>
    update.mutate(
      { id: category.id, input: { is_archived: !category.is_archived } },
      { onError: (error) => toast.error(errorMessage(error)) },
    )
  return (
    <li className="flex min-h-11 items-center gap-3 py-1.5">
      <div className={cn('grid min-w-0 flex-1', category.is_archived && 'text-muted-foreground')}>
        <span className="truncate text-body-sm">{label}</span>
        <span className="truncate text-caption text-muted-foreground">
          {[
            category.vat_treatment &&
              `${VAT_TREATMENT_LABELS[category.vat_treatment]()}${rate && rate !== '0' ? ` ${rate}%` : ''}`,
            translate('importExpenseCount', { count: category.expenses_count }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <Badge variant="outline" className="tabular-nums">
        {category.account_code}
      </Badge>
      <IconAction label={translate('edit')} onClick={onEdit}>
        <Pencil />
      </IconAction>
      <IconAction
        label={category.is_archived ? translate('restore') : translate('archive')}
        disabled={update.isPending}
        onClick={toggleArchived}
      >
        {category.is_archived ? <ArchiveRestore /> : <Archive />}
      </IconAction>
    </li>
  )
}

/** Changes only what was changed: an untouched translated name is never sent back, so the category stays a preset. */
export function categoryChanges(
  category: Pick<ExpenseCategory, 'name' | 'preset' | 'account_code'>,
  name: string,
  account: string,
): CategoryUpdate {
  const changes: CategoryUpdate = {}
  if (name.trim() !== categoryLabel(category)) changes.name = name.trim()
  if (account.trim() !== category.account_code) changes.account_code = account.trim()
  return changes
}

function CategoryEditor({ category, onDone }: { category: ExpenseCategory; onDone: () => void }) {
  const update = useUpdateExpenseCategory()
  const [name, setName] = useState(() => categoryLabel(category))
  const [account, setAccount] = useState(category.account_code)
  const [errors, setErrors] = useState<FieldErrors>({})
  const id = `category-${category.id}`
  // The row's Edit button is gone; the name takes the focus it had.
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => nameField.current?.focus(), [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = categoryChanges(category, name, account)
    if (Object.keys(input).length === 0) return onDone()
    update.mutate(
      { id: category.id, input },
      {
        onSuccess: onDone,
        onError: (error) => {
          const fields = apiFieldErrors(error)
          if (fields) setErrors(fields)
          else toast.error(errorMessage(error))
        },
      },
    )
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_8rem]">
      <FormField
        id={`${id}-name`}
        label={translate('categoryName')}
        error={errors.name}
        hint={category.preset ? translate('renamingKeepsYourName') : undefined}
      >
        <input
          ref={nameField}
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </FormField>
      <FormField
        id={`${id}-account`}
        label={translate('accountCode')}
        tip={translate('accountCodeTip')}
        error={errors.account_code}
      >
        <input
          id={`${id}-account`}
          inputMode="numeric"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className={inputClass}
        />
      </FormField>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {translate('cancel')}
        </Button>
        <Button type="submit" disabled={update.isPending || !name.trim()}>
          {translate('saveChanges')}
        </Button>
      </div>
    </form>
  )
}
