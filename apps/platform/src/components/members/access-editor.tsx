'use client'
import { InlineError } from '@helvetly/ui/components/inline-error'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { Lock } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { PlanTag, useFeatureLock } from '@/components/billing/feature-lock'
import { HelpTip } from '@/components/settings/help-tip'
import { translate } from '@/lib/i18n'
import {
  describeHR,
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
  { level: 'none', label: translate('noAccess') },
  { level: 'view', label: translate('view2') },
  { level: 'edit', label: translate('edit') },
]

const GENERAL = RESOURCES.filter((resource) => !('hr' in resource))
const HR = RESOURCES.filter((resource) => 'hr' in resource)

/**
 * A preset as a segmented control, and for Custom a matrix: what the member sees and changes. The two HR rows sit
 * below; only an owner changes them, and only while the plan includes Employees. For an admin (`admin`) the general
 * areas are fixed at full and `value` is the HR scopes alone.
 */
export function AccessEditor({
  value,
  onChange,
  error,
  canChangeHR = false,
  admin = false,
}: {
  value: string[]
  onChange: (scopes: string[]) => void
  error?: string | null
  /** Only an owner grants or withdraws employee and payroll access (the API refuses anyone else). */
  canChangeHR?: boolean
  admin?: boolean
}) {
  const id = useId()
  // Custom stays open while its matrix happens to equal a preset, so editing never jumps away.
  const [custom, setCustom] = useState(() => presetOf(value) === 'custom')
  const lock = useFeatureLock('employees')
  const hrEditable = canChangeHR && !lock
  const selected = custom ? 'custom' : presetOf(value)
  const levels = levelsOf(value)
  const hr = describeHR(value)
  const problem =
    error ?? (!admin && value.length === 0 ? translate('giveAccessToAtLeastOneArea') : null)

  return (
    <div className="grid gap-2">
      {admin ? (
        <p className="text-body-sm text-muted-foreground">
          {translate('accessWithHR', {
            general: translate('accessAdminGeneral'),
            hr: hr ?? translate('accessNoHR'),
          })}
        </p>
      ) : (
        <>
          {/* Scrolls sideways on a phone rather than wrapping the choices. */}
          <div className="min-w-0 [scrollbar-width:none] overflow-x-auto">
            <Segmented
              label={translate('access')}
              value={selected}
              options={PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
              onChange={(next) => {
                const preset = PRESETS.find((entry) => entry.id === next)
                setCustom(!preset?.scopes)
                if (preset?.scopes)
                  onChange([...preset.scopes, ...(hrEditable ? preset.hr : hrScopes(value))])
              }}
            />
          </div>
          <p className="text-body-sm text-muted-foreground">
            {PRESETS.find((preset) => preset.id === selected)?.description}
            {hr && ` ${translate('accessHRSummary', { hr })}`}
          </p>
        </>
      )}
      {!admin && custom && (
        <Matrix
          label={translate('area')}
          heading={translate('area')}
          rows={GENERAL}
          name={id}
          levels={levels}
          onChange={onChange}
          note={translate('membersWorkspaceAndBillingStayWithOwnersAndAdmins')}
        />
      )}
      <Matrix
        label={translate('accessHRSection')}
        heading={
          <span className="inline-flex items-center gap-1.5">
            {translate('accessHRSection')}
            <HelpTip label={translate('accessHRHelpLabel')}>
              {translate('accessSealedHelp')}
            </HelpTip>
            {lock ? <PlanTag lock={lock} className="ml-0" /> : !canChangeHR && <OwnerOnly />}
          </span>
        }
        rows={HR}
        name={id}
        levels={levels}
        onChange={(scopes) => onChange(admin ? hrScopes(scopes) : scopes)}
        disabled={!hrEditable}
        reason={lock ? `${lock.hint}.` : translate('accessHROwnerOnly')}
      />
      {problem && <InlineError>{problem}</InlineError>}
    </div>
  )
}

/** The lock beside the HR heading: a focusable way to read why the rows are off. */
function OwnerOnly() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={translate('accessHROwnerOnly')}
          className="inline-flex rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Lock className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">
        {translate('accessHROwnerOnly')}
      </TooltipContent>
    </Tooltip>
  )
}

function Matrix({
  label,
  heading,
  rows,
  name,
  levels,
  onChange,
  disabled = false,
  reason,
  note,
}: {
  label: string
  heading: ReactNode
  rows: readonly (typeof RESOURCES)[number][]
  name: string
  levels: Levels
  onChange: (scopes: string[]) => void
  disabled?: boolean
  /** Why the rows are disabled, on hover over them. */
  reason?: string
  note?: string
}) {
  const body = (
    <tbody>
      {rows.map((resource) => (
        <tr key={resource.id} className="border-t">
          <th scope="row" className="py-1.5 pr-2 text-left font-normal">
            {resource.label}
            <span className="block text-caption text-muted-foreground">{resource.description}</span>
          </th>
          {LEVELS.map(({ level, label: levelLabel }) => (
            <td key={level} className="text-center">
              {level === 'edit' && 'viewOnly' in resource ? (
                <span className="text-muted-foreground" title={resource.viewOnly}>
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
                  // A disabled radio swallows the pointer, so the row's tooltip would never open over it.
                  className="size-4 cursor-pointer accent-foreground disabled:pointer-events-none disabled:opacity-50"
                />
              )}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
  return (
    <table aria-label={label} className="w-full text-body-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">{heading}</th>
          {LEVELS.map(({ level, label: levelLabel }) => (
            <th key={level} className="w-16 py-1 text-center font-medium">
              {levelLabel}
            </th>
          ))}
        </tr>
      </thead>
      {disabled && reason ? (
        <Tooltip>
          <TooltipTrigger asChild>{body}</TooltipTrigger>
          <TooltipContent className="max-w-72 text-pretty">{reason}</TooltipContent>
        </Tooltip>
      ) : (
        body
      )}
      {note && (
        <tfoot>
          <tr>
            <td colSpan={4} className="border-t pt-2 text-caption text-muted-foreground">
              {note}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}
