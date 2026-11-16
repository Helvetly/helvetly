'use client'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'

import { translate } from '@/lib/i18n'

/** How the one-time suggestion stands: not asked, asking, or why it ended without a usable name. */
export type SuggestionState =
  | 'idle'
  | 'pending'
  | 'applied'
  | 'failed' // can be asked again (rate limit, network)
  | 'failedSpent' // the provider was reached and gave nothing usable: the one use is gone
  | 'used'
  | 'unavailable'

/**
 * The optional, one-time AI name suggestion under the workspace name: an unticked consent (only the company name
 * goes to OpenAI), one explicit click, and a polite note on how it went. The name field stays editable throughout.
 */
export function WorkspaceNameSuggest({
  state,
  consent,
  canAsk,
  onConsent,
  onAsk,
}: {
  state: SuggestionState
  consent: boolean
  /** A company name is entered. */
  canAsk: boolean
  onConsent: (value: boolean) => void
  onAsk: () => void
}) {
  const note = {
    applied: translate('workspaceNameSuggested'),
    failed: translate('workspaceNameSuggestionFailed'),
    failedSpent: translate('workspaceNameSuggestionFailed'),
    used: translate('workspaceNameSuggestionUsed'),
    unavailable: translate('workspaceNameSuggestionUnavailable'),
    pending: '',
    idle: '',
  }[state]
  // Spent, or not offered here at all: only the note remains.
  const asking = state === 'idle' || state === 'pending' || state === 'failed'
  return (
    <div className="grid gap-2.5 rounded-xl border bg-card p-3.5">
      {asking && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <label className="flex min-w-0 flex-1 basis-56 items-start gap-2.5 text-sm text-pretty">
            <Checkbox
              className="mt-0.5"
              checked={consent}
              disabled={state === 'pending'}
              onCheckedChange={(value) => onConsent(value === true)}
            />
            {translate('suggestWorkspaceNameConsent')}
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!consent || !canAsk || state === 'pending'}
            onClick={onAsk}
          >
            {state === 'pending' ? translate('suggestingAName') : translate('suggestAName')}
          </Button>
        </div>
      )}
      <output aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
        {note}
      </output>
    </div>
  )
}
