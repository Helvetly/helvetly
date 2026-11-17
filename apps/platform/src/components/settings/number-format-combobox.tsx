'use client'

import { Combobox } from '@/components/clients/fields'
import { translate } from '@/lib/i18n'
import { exampleNumber, NUMBER_FORMATS, today, type NumberFormat } from '@/lib/invoices'

/** The number format choice, each option shown as the number it makes this year; Settings → Invoices and the welcome share it. */
export function NumberFormatCombobox({
  id,
  value,
  onChange,
}: {
  id: string
  value: NumberFormat
  onChange: (format: NumberFormat) => void
}) {
  const year = Number(today().slice(0, 4))
  return (
    <Combobox
      id={id}
      value={value}
      options={NUMBER_FORMATS.map((format) => ({
        value: format,
        label: exampleNumber(format, year, 1),
        hint: format,
      }))}
      renderValue={(option) => (
        <span className="flex items-baseline gap-2">
          <span className="font-mono">{option.label}</span>
          <span className="text-muted-foreground">{option.hint}</span>
        </span>
      )}
      placeholder={translate('chooseAFormat')}
      onChange={(format) => {
        const picked = NUMBER_FORMATS.find((entry) => entry === format)
        if (picked) onChange(picked)
      }}
    />
  )
}
