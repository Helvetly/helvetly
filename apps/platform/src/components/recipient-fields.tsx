'use client'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { cn } from '@helvetly/ui/lib/utils'
import { useRef, useState } from 'react'

import { inputClass as fieldClass } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'

type Copy = 'cc' | 'bcc'

/**
 * A send dialog's To, with quiet Cc and Bcc buttons at the right of its label. A button reveals its field with the
 * cursor in it; a field holding addresses (or an error) always shows, and an emptied one folds away again on blur.
 * Ids are `<id>-to`, `<id>-cc` and `<id>-bcc`.
 */
export function RecipientFields({
  id,
  to,
  onToChange,
  toTip,
  toPlaceholder,
  toReadOnly,
  cc,
  onCcChange,
  bcc,
  onBccChange,
  errors,
}: {
  id: string
  to: string
  onToChange: (value: string) => void
  toTip: string
  toPlaceholder: string
  toReadOnly?: boolean
  cc: string
  onCcChange: (value: string) => void
  bcc: string
  onBccChange: (value: string) => void
  errors: Record<string, string>
}) {
  const [open, setOpen] = useState<Record<Copy, boolean>>({ cc: false, bcc: false })
  const focusNext = useRef<Copy | null>(null)
  const copies = [
    { key: 'cc' as const, label: translate('cc'), value: cc, onChange: onCcChange },
    { key: 'bcc' as const, label: translate('bcc'), value: bcc, onChange: onBccChange },
  ]
  const shown = (copy: (typeof copies)[number]) =>
    open[copy.key] || copy.value.trim() !== '' || Boolean(errors[copy.key])

  return (
    <>
      <div className="relative grid">
        <FormField id={`${id}-to`} label={translate('to3')} required error={errors.to} tip={toTip}>
          <input
            {...describedBy(`${id}-to`, errors.to)}
            type="email"
            multiple
            value={to}
            // Read-only, not disabled, while a draft loads: the dialog's first focus lands here.
            readOnly={toReadOnly}
            onChange={(event) => onToChange(event.target.value)}
            placeholder={toPlaceholder}
            className={fieldClass}
          />
        </FormField>
        {/* After the input, so Tab goes To → Cc → Bcc; both keep their place, so neither moves under the pointer. */}
        <div className="absolute top-0 right-0 flex gap-3">
          {copies.map((copy) => (
            <button
              key={copy.key}
              type="button"
              className={cn(
                'rounded-sm text-body-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                shown(copy) && 'invisible',
              )}
              onClick={() => {
                focusNext.current = copy.key
                setOpen((was) => ({ ...was, [copy.key]: true }))
              }}
            >
              {copy.label}
            </button>
          ))}
        </div>
      </div>
      {copies.filter(shown).map((copy) => (
        <FormField
          key={copy.key}
          id={`${id}-${copy.key}`}
          label={copy.label}
          error={errors[copy.key]}
          tip={copy.key === 'bcc' ? translate('bccTip') : undefined}
        >
          <input
            {...describedBy(`${id}-${copy.key}`, errors[copy.key])}
            ref={(input) => {
              if (input && focusNext.current === copy.key) {
                focusNext.current = null
                input.focus()
              }
            }}
            type="email"
            multiple
            value={copy.value}
            onChange={(event) => copy.onChange(event.target.value)}
            onBlur={() => {
              if (!copy.value.trim()) setOpen((was) => ({ ...was, [copy.key]: false }))
            }}
            placeholder={translate('optional')}
            className={fieldClass}
          />
        </FormField>
      ))}
    </>
  )
}
