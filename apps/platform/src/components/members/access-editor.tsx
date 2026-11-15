'use client'

import { Segmented } from '@helvetly/ui/components/segmented'
import { useId, useState } from 'react'

import {
  describeAccess,
  hrScopes,
  levelsOf,
  PRESETS,
  presetOf,
  RESOURCES,
  scopesFor,
  type Level,
  type Levels,
} from '@/lib/permissions'

const LEVELS: { level: Level; label: string }[] = [
  { level: 'none', label: 'No access' },
  { level: 'view', label: 'View' },
  { level: 'edit', label: 'Edit' },
]

const GENERAL = RESOURCES.filter((resource) => !('hr' in resource))
const HR = RESOURCES.filter((resource) => 'hr' in resource)

/** A preset as a segmented control, and for Custom a matrix: what the member sees and changes. */
export function AccessEditor({
  value,
  onChange,
  error,
  canChangeHR = false,
}: {
  value: string[]
  onChange: (scopes: string[]) => void
  error?: string | null
  /** Only an owner grants or withdraws employee and payroll access (the API refuses anyone else). */
  canChangeHR?: boolean
}) {
  const id = useId()
  // Custom stays open while its matrix happens to equal a preset, so editing never jumps away.
  const [custom, setCustom] = useState(() => presetOf(value) === 'custom')
  const selected = custom ? 'custom' : presetOf(value)
  const levels = levelsOf(value)
  const problem = error ?? (value.length === 0 ? 'Give access to at least one area.' : null)

  return (
    <div className="grid gap-2">
      {/* Scrolls sideways on a phone rather than wrapping the four choices. */}
      <div className="min-w-0 [scrollbar-width:none] overflow-x-auto">
        <Segmented
          label="Access"
          value={selected}
          options={PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          onChange={(next) => {
            const preset = PRESETS.find((entry) => entry.id === next)
            setCustom(!preset?.scopes)
            if (preset?.scopes) onChange([...preset.scopes, ...hrScopes(value)])
          }}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">{describeAccess(value)}</p>
      {custom && (
        <Matrix
          label="Areas"
          rows={GENERAL}
          name={id}
          levels={levels}
          onChange={onChange}
          note="Managing members, settings and billing stays with owners and admins."
        />
      )}
      <Matrix
        label="Employees and payroll"
        rows={HR}
        name={id}
        levels={levels}
        onChange={onChange}
        disabled={!canChangeHR}
        note="Only owners can change access to employees and payroll. Full access and the other presets never include it."
      />
      {problem && (
        <p role="alert" className="text-[13px] text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}

function Matrix({
  label,
  rows,
  name,
  levels,
  onChange,
  disabled = false,
  note,
}: {
  label: string
  rows: readonly (typeof RESOURCES)[number][]
  name: string
  levels: Levels
  onChange: (scopes: string[]) => void
  disabled?: boolean
  note: string
}) {
  return (
    <table aria-label={label} className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">{label === 'Areas' ? 'Area' : label}</th>
          {LEVELS.map(({ level, label: levelLabel }) => (
            <th key={level} className="w-16 py-1 text-center font-medium">
              {levelLabel}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((resource) => (
          <tr key={resource.id} className="border-t">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              {resource.label}
              <span className="block text-[12px] text-muted-foreground">
                {resource.description}
              </span>
            </th>
            {LEVELS.map(({ level, label: levelLabel }) => (
              <td key={level} className="text-center">
                {(level === 'edit' && 'viewOnly' in resource) ||
                (level === 'view' && 'editOnly' in resource) ? (
                  <span
                    className="text-muted-foreground"
                    title={
                      'editOnly' in resource
                        ? 'Approving is a change: no view level'
                        : 'Owners and admins manage this'
                    }
                  >
                    –
                  </span>
                ) : (
                  <input
                    type="radio"
                    name={`${name}-${resource.id}`}
                    aria-label={`${resource.label}: ${levelLabel}`}
                    checked={levels[resource.id] === level}
                    disabled={disabled}
                    onChange={() => onChange(scopesFor({ ...levels, [resource.id]: level }))}
                    className="size-4 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="border-t pt-2 text-[12px] text-muted-foreground">
            {note}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}
