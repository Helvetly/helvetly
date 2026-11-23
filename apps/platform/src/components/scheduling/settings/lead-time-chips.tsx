'use client'
import { Input } from '@helvetly/ui/components/input'
import { X } from 'lucide-react'
import { useState } from 'react'

import { translate } from '@/lib/i18n'
import { durationText, parseLeadTime } from '@/lib/scheduling-settings'

/** Lead times in minutes as removable chips, longest first, with a field to add one ("1 d", "2 h", "30 min"). */
export function LeadTimeChips({
  id,
  label,
  value,
  onChange,
  max = 5,
}: {
  id: string
  label: string
  value: number[]
  onChange: (minutes: number[]) => void
  max?: number
}) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const add = () => {
    if (!text.trim()) return
    const minutes = parseLeadTime(text)
    if (minutes === null) return setProblem(translate('schedulingSettingsLeadTimeInvalid'))
    if (!value.includes(minutes)) onChange([...value, minutes].toSorted((a, b) => b - a))
    setText('')
    setProblem('')
  }
  return (
    <div className="grid gap-2">
      <ul aria-label={label} className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <li className="text-body-sm text-muted-foreground">
            {translate('schedulingSettingsNoReminders')}
          </li>
        )}
        {value.map((minutes) => (
          <li
            key={minutes}
            className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-body-sm"
          >
            {translate('schedulingSettingsBefore', { time: durationText(minutes) })}
            <button
              type="button"
              aria-label={translate('schedulingSettingsRemoveReminder', {
                time: durationText(minutes),
              })}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onChange(value.filter((one) => one !== minutes))}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {value.length < max && (
        <div className="grid max-w-56 gap-1">
          <Input
            id={id}
            aria-label={translate('schedulingSettingsAddReminder', { label })}
            aria-invalid={problem ? true : undefined}
            placeholder={translate('schedulingSettingsLeadTimePlaceholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setProblem('')
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // Enter adds the chip; it must not submit the section's form.
              event.preventDefault()
              add()
            }}
            onBlur={add}
          />
          {problem && (
            <p role="alert" className="text-body-sm text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
