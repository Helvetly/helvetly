'use client'
import { Combobox } from '@helvetly/ui/components/combobox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@helvetly/ui/components/input-group'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import {
  durationMinutes,
  presetText,
  splitDuration,
  type DurationUnit,
} from '@/lib/scheduling-settings'

const CUSTOM = 'custom'

/**
 * A length of time in minutes as readable presets ("24 hours before") plus "Custom…", which shows an amount with
 * its unit beside it. `suffix` words the presets and units ("before" / "after"); `zero` names a 0 preset.
 */
export function DurationSelect({
  id,
  value,
  onChange,
  presets,
  units,
  suffix,
  zero,
  invalid,
}: {
  id: string
  value: number
  onChange: (minutes: number) => void
  presets: readonly number[]
  units: readonly DurationUnit[]
  suffix?: 'before' | 'after'
  zero?: string
  invalid?: boolean
}) {
  const [custom, setCustom] = useState(() => !presets.includes(value))
  const start = splitDuration(Number.isFinite(value) ? value : 0, units)
  const [amount, setAmount] = useState(Number.isFinite(value) ? String(start.amount) : '')
  const [unit, setUnit] = useState<DurationUnit>(start.unit)
  const worded = (text: string) =>
    suffix === 'before'
      ? translate('schedulingSettingsBefore', { time: text })
      : suffix === 'after'
        ? translate('schedulingSettingsAfter', { time: text })
        : text
  const options = [
    ...presets.map((minutes) => ({
      value: String(minutes),
      label: minutes === 0 && zero ? zero : worded(presetText(minutes)),
    })),
    { value: CUSTOM, label: translate('schedulingSettingsCustom') },
  ]
  return (
    <>
      <Combobox
        id={id}
        value={custom ? CUSTOM : String(value)}
        options={options}
        searchable={false}
        invalid={invalid}
        placeholder={translate('schedulingSettingsCustom')}
        onChange={(next) => {
          if (next !== CUSTOM) {
            setCustom(false)
            return onChange(Number(next))
          }
          const split = splitDuration(Number.isFinite(value) ? value : 0, units)
          setAmount(String(split.amount))
          setUnit(split.unit)
          setCustom(true)
        }}
      />
      {custom && (
        <InputGroup className="mt-2">
          <InputGroupInput
            id={`${id}-amount`}
            aria-label={translate('schedulingSettingsCustomAmount')}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              onChange(durationMinutes(event.target.value, unit))
            }}
          />
          <InputGroupAddon align="inline-end">
            <select
              aria-label={translate('schedulingSettingsCustomUnit')}
              className="h-7 cursor-pointer rounded-md bg-transparent pr-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              value={unit}
              onChange={(event) => {
                const next = units.find((one) => one === event.target.value) ?? unit
                setUnit(next)
                onChange(durationMinutes(amount, next))
              }}
            >
              {units.map((one) => (
                <option key={one} value={one}>
                  {translate(
                    suffix === 'before'
                      ? 'schedulingSettingsUnitBefore'
                      : suffix === 'after'
                        ? 'schedulingSettingsUnitAfter'
                        : 'schedulingSettingsUnit',
                    { unit: one },
                  )}
                </option>
              ))}
            </select>
          </InputGroupAddon>
        </InputGroup>
      )}
    </>
  )
}
