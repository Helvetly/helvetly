'use client'

import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import { useRef, useState } from 'react'

import { Combobox, inputClass } from '@/components/clients/fields'
import { HelpTip } from '@/components/settings/help-tip'
import { translate } from '@/lib/i18n'
import { exampleNumber, numberFormatsFor, today, type NumberFormat } from '@/lib/invoices'

const CUSTOM = 'custom'

const TOKENS = [
  { token: '{YYYY}', label: translate('numberTokenYear') },
  { token: '{YY}', label: translate('numberTokenShortYear') },
  { token: '{MM}', label: translate('numberTokenMonth') },
  { token: '{DD}', label: translate('numberTokenDay') },
  { token: '{TYPE}', label: translate('numberTokenType') },
  { token: '{NNN}', label: translate('numberTokenRunning') },
]

/** The number format: a preset, each shown as the number it makes today, or one's own with placeholders.
 * Settings → Invoices and the welcome share it. */
export function NumberFormatField({
  id,
  country,
  value,
  invalid,
  onChange,
}: {
  id: string
  /** The seller's country, which picks the presets. */
  country: string | undefined
  value: NumberFormat
  invalid?: boolean
  onChange: (format: NumberFormat) => void
}) {
  const date = today()
  const [customChosen, setCustomChosen] = useState(false)
  const presets = numberFormatsFor(country)
  const custom = customChosen || !presets.includes(value)
  const input = useRef<HTMLInputElement>(null)
  const insert = (token: string) => {
    const field = input.current
    const start = field?.selectionStart ?? value.length
    const end = field?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + token + value.slice(end))
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className="grid gap-2">
      <Combobox
        id={id}
        value={custom ? CUSTOM : value}
        options={[
          ...presets.map((format) => ({
            value: format,
            label: exampleNumber(format, date, 1),
            hint: format,
          })),
          { value: CUSTOM, label: translate('customNumberFormat') },
        ]}
        renderValue={(option) => (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn('shrink-0', option.value !== CUSTOM && 'font-code')}>
              {option.label}
            </span>
            {option.hint && (
              <span className="min-w-0 truncate text-body-sm text-muted-foreground">
                {option.hint}
              </span>
            )}
          </span>
        )}
        placeholder={translate('chooseAFormat')}
        onChange={(format) => {
          setCustomChosen(format === CUSTOM)
          if (format !== CUSTOM) onChange(format)
        }}
      />
      {custom && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              ref={input}
              aria-label={translate('customNumberFormat')}
              aria-invalid={invalid || undefined}
              className={cn(inputClass, 'font-code')}
              value={value}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => onChange(event.target.value)}
            />
            <HelpTip label={translate('customNumberFormat')}>
              {translate('numberFormatHelp')}
            </HelpTip>
          </div>
          <fieldset aria-label={translate('insertAPlaceholder')} className="flex flex-wrap gap-1.5">
            {TOKENS.map(({ token, label }) => (
              <Button
                key={token}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => insert(token)}
              >
                {label}
                <span className="font-code text-muted-foreground">{token}</span>
              </Button>
            ))}
          </fieldset>
        </>
      )}
    </div>
  )
}
