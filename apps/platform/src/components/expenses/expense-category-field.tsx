'use client'
import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Popover, PopoverAnchor, PopoverContent } from '@helvetly/ui/components/popover'
import { useState, type KeyboardEvent } from 'react'

import { Combobox, inputClass } from '@/components/clients/fields'
import { errorMessage } from '@/lib/api'
import { categoryGroup, categoryLabel } from '@/lib/expense-categories'
import {
  canManageExpenses,
  useCreateExpenseCategory,
  useExpenseCategories,
  type ExpenseCategory,
} from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

const DEFAULT_ACCOUNT = '6700'

/**
 * The active expense categories as a picker; for owners and admins its last row adds a category (named after what
 * was typed) and selects it. `by` is what the value holds: the category's id (the expense form) or its name (an import
 * record, which the server resolves). With `by="name"` a value no category carries shows as a suggestion to create.
 */
export function ExpenseCategoryField({
  id,
  value,
  by = 'id',
  invalid,
  onChange,
}: {
  id?: string
  value: string
  by?: 'id' | 'name'
  invalid?: boolean
  onChange: (value: string) => void
}) {
  const categories = useExpenseCategories()
  const canManage = canManageExpenses(useSession().data?.role)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [account, setAccount] = useState(DEFAULT_ACCOUNT)
  const create = useCreateExpenseCategory()
  const active = (categories.data ?? []).filter((category) => !category.is_archived)
  const key = (category: ExpenseCategory) => (by === 'id' ? category.id : category.name)
  const options = active.map((category) => ({
    value: key(category),
    label: categoryLabel(category),
    hint: category.account_code,
    group: categoryGroup(category.account_code),
  }))
  const suggested =
    by === 'name' &&
    value.trim() !== '' &&
    categories.isSuccess &&
    !active.some((category) => category.name.toLowerCase() === value.trim().toLowerCase())
      ? value.trim()
      : ''

  const openWith = (next: string) => {
    setName(next)
    setAccount(DEFAULT_ACCOUNT)
    create.reset()
    setOpen(true)
  }
  const submit = () => {
    if (create.isPending || !name.trim()) return
    create.mutate(
      { name: name.trim(), account_code: account.trim() },
      {
        onSuccess: (category) => {
          onChange(key(category))
          setOpen(false)
        },
      },
    )
  }

  const enterCreates = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit()
  }

  return (
    <div className="grid gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor className="grid min-w-0">
          <Combobox
            id={id}
            value={value}
            options={options}
            invalid={invalid}
            disabled={categories.isSuccess && options.length === 0 && !canManage}
            onCreate={canManage ? openWith : undefined}
            createLabel={translate('addCategory')}
            placeholder={
              categories.isPending
                ? translate('loadingCategories')
                : options.length === 0
                  ? translate('noCategoriesYet')
                  : translate('chooseACategory')
            }
            renderValue={(option) => (
              <span>
                {option.label}{' '}
                <span className="text-muted-foreground tabular-nums">{option.hint}</span>
              </span>
            )}
            onChange={onChange}
          />
        </PopoverAnchor>
        {canManage && (
          <PopoverContent align="end" className="grid w-72 gap-3">
            {/* A div, not a form: this field sits inside the expense form, and portal events bubble to it. */}
            <div className="grid gap-3">
              <FormField id={`${id ?? 'category'}-new-name`} label={translate('categoryName')}>
                <input
                  id={`${id ?? 'category'}-new-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={enterCreates}
                  className={inputClass}
                />
              </FormField>
              <FormField
                id={`${id ?? 'category'}-new-account`}
                label={translate('accountCode')}
                tip={translate('accountCodeTip')}
                hint={translate('otherOperatingCosts')}
              >
                <input
                  id={`${id ?? 'category'}-new-account`}
                  inputMode="numeric"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  onKeyDown={enterCreates}
                  className={inputClass}
                />
              </FormField>
              {create.error && (
                <p role="alert" className="text-caption text-destructive">
                  {errorMessage(create.error)}
                </p>
              )}
              <Button type="button" disabled={create.isPending || !name.trim()} onClick={submit}>
                {translate('create')}
              </Button>
            </div>
          </PopoverContent>
        )}
      </Popover>
      {/* The line is always reserved in name mode, so a suggestion never moves the fields below. */}
      {by === 'name' && (
        <p className="flex min-h-7 items-center gap-2 text-caption text-muted-foreground">
          {suggested && (
            <>
              <span>{translate('suggestedNewCategory', { name: suggested })}</span>
              {canManage && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => openWith(suggested)}
                >
                  {translate('create')}
                </Button>
              )}
            </>
          )}
        </p>
      )}
    </div>
  )
}
