'use client'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@helvetly/ui/components/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { LoaderCircle } from 'lucide-react'
import { useId, type ComponentProps } from 'react'

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

export type Suggestion = {
  state: SuggestionState
  /** A company name is entered. */
  canAsk: boolean
  /** The person's own click: it is their consent to send the company name, and the only thing that asks. */
  onAsk: () => void
}

/**
 * The workspace name field with the optional, one-time AI suggestion inside it, on the right. Clicking Suggest is the
 * consent (only the company name goes to OpenAI, said by the button's tooltip and description); the answer lands in
 * the field itself, still editable. How it went is told apart from the field: out loud when it worked, in a line
 * under the field when it did not. Without `suggestion` it is a plain field.
 */
export function WorkspaceNameInput({
  suggestion,
  ...input
}: { suggestion: Suggestion | null } & Omit<ComponentProps<'input'>, 'className'>) {
  const consentId = useId()
  if (!suggestion)
    return (
      <InputGroup className="h-9 bg-card">
        <InputGroupInput {...input} />
      </InputGroup>
    )
  const { state, canAsk, onAsk } = suggestion
  const pending = state === 'pending'
  // Spent, or not offered here at all: no button, only the note.
  const asking = state === 'idle' || pending || state === 'failed'
  const note = {
    failed: translate('workspaceNameSuggestionFailed'),
    failedSpent: translate('workspaceNameSuggestionFailed'),
    used: translate('workspaceNameSuggestionUsed'),
    unavailable: translate('workspaceNameSuggestionUnavailable'),
    applied: '',
    pending: '',
    idle: '',
  }[state]
  return (
    <>
      <InputGroup className="h-9 bg-card">
        <InputGroupInput {...input} />
        {asking && (
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  variant="outline"
                  aria-describedby={consentId}
                  aria-busy={pending}
                  disabled={!canAsk || pending}
                  onClick={onAsk}
                >
                  {pending && (
                    <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                  )}
                  {pending ? translate('suggestingAName') : translate('suggestAName')}
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>{translate('suggestWorkspaceNameConsent')}</TooltipContent>
            </Tooltip>
            <span id={consentId} className="sr-only">
              {translate('suggestWorkspaceNameConsent')}
            </span>
          </InputGroupAddon>
        )}
      </InputGroup>
      <output
        aria-live="polite"
        className="mt-1.5 block text-xs text-muted-foreground empty:hidden"
      >
        {note}
      </output>
      <output aria-live="polite" className="sr-only">
        {state === 'applied' && translate('workspaceNameSuggested')}
      </output>
    </>
  )
}
