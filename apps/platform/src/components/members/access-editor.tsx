'use client'
import { Segmented } from '@helvetly/ui/components/segmented'
import { useId, useState } from 'react'

import { translate } from '@/lib/i18n'
import { levelsOf, PRESETS, presetOf, RESOURCES, scopesFor, type Level } from '@/lib/permissions'

const LEVELS: { level: Level; label: string }[] = [
  { level: 'none', label: translate('noAccess') },
  { level: 'view', label: translate('view2') },
  { level: 'edit', label: translate('edit') },
]

/** A preset as a segmented control, and for Custom a matrix: what the member sees and changes. */
export function AccessEditor({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (scopes: string[]) => void
  error?: string | null
}) {
  const id = useId()
  // Custom stays open while its matrix happens to equal a preset, so editing never jumps away.
  const [custom, setCustom] = useState(() => presetOf(value) === 'custom')
  const selected = custom ? 'custom' : presetOf(value)
  const levels = levelsOf(value)
  const problem = error ?? (value.length === 0 ? translate('giveAccessToAtLeastOneArea') : null)

  return (
    <div className="grid gap-2">
      {/* Scrolls sideways on a phone rather than wrapping the choices. */}
      <div className="min-w-0 [scrollbar-width:none] overflow-x-auto">
        <Segmented
          label={translate('access')}
          value={selected}
          options={PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          onChange={(next) => {
            const preset = PRESETS.find((entry) => entry.id === next)
            setCustom(!preset?.scopes)
            if (preset?.scopes) onChange(preset.scopes)
          }}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {PRESETS.find((preset) => preset.id === selected)?.description}
      </p>
      {custom && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">{translate('area')}</th>
              {LEVELS.map(({ level, label }) => (
                <th key={level} className="w-16 py-1 text-center font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((resource) => (
              <tr key={resource.id} className="border-t">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  {resource.label}
                  <span className="block text-[12px] text-muted-foreground">
                    {resource.description}
                  </span>
                </th>
                {LEVELS.map(({ level, label }) => (
                  <td key={level} className="text-center">
                    {level === 'edit' && 'viewOnly' in resource ? (
                      <span className="text-muted-foreground" title={resource.viewOnly}>
                        –
                      </span>
                    ) : (
                      <input
                        type="radio"
                        name={`${id}-${resource.id}`}
                        aria-label={`${resource.label}: ${label}`}
                        checked={levels[resource.id] === level}
                        onChange={() => onChange(scopesFor({ ...levels, [resource.id]: level }))}
                        className="size-4 cursor-pointer accent-foreground"
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
                {translate('membersWorkspaceAndBillingStayWithOwnersAndAdmins')}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
      {problem && (
        <p role="alert" className="text-[13px] text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
