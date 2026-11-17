'use client'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Meter } from '@helvetly/ui/components/meter'
import { cn } from '@helvetly/ui/lib/utils'
import { Sparkles } from 'lucide-react'

import { SettingsSection } from '@/components/settings/layout'
import { type Billing, formatTokens, meterState } from '@/lib/billing'
import { translate } from '@/lib/i18n'

/**
 * The month's AI tokens for Heidi (AI import and filing have their own), and how the allowance is made up, while tokens from packs bought
 * earlier still count this month. Packs are no longer sold, so nothing is offered here.
 */
export function AITokenPacks({ billing }: { billing: Billing }) {
  const item = billing.usage.find((u) => u.limit === 'ai_tokens_per_month')
  if (!item || billing.ai_tokens_bought <= 0) return null
  return (
    <SettingsSection
      id="ai-tokens"
      icon={Sparkles}
      title={translate('aiTokens')}
      description={
        <span className="inline-flex items-center gap-1.5">
          {translate('usedByHeidi')}
          <HelpTip label={translate('aiTokens')}>{translate('packTokensAddToThePlan')}</HelpTip>
        </span>
      }
    >
      <TokenUsage item={item} bought={billing.ai_tokens_bought} />
    </SettingsSection>
  )
}

const NOTE = {
  near: { text: translate('almostUsedUp'), className: 'text-warning' },
  full: { text: translate('usedUp'), className: 'text-destructive' },
  off: { text: translate('notIncluded'), className: 'text-muted-foreground' },
}

/** "1.2M of 6M used this month" over the shared meter, and how the allowance is made up. */
function TokenUsage({ item, bought }: { item: Billing['usage'][number]; bought: number }) {
  const used = formatTokens(item.used)
  const max = item.max === null ? null : formatTokens(item.max)
  const state = meterState(item)
  const note = state === 'ok' ? null : NOTE[state]
  return (
    <div className="grid gap-2" data-slot="ai-tokens-used" data-state={state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
          <span className="text-title font-semibold tracking-[-0.01em]">{used}</span>
          <span className="text-body-sm text-muted-foreground">
            {translate('of')}
            {max ?? 'unlimited'}
            {translate('usedThisMonth')}
          </span>
        </p>
        {note && (
          <span className={cn('text-caption font-medium', note.className)}>{note.text}</span>
        )}
      </div>
      {item.max === null ? (
        <div aria-hidden className="h-1.5 rounded-full bg-muted" />
      ) : (
        <Meter
          label={translate('aiTokensOfUsed', { used: used, max: max })}
          value={item.used}
          max={item.max}
        />
      )}
      {bought > 0 && item.max !== null && (
        <p className="text-caption text-muted-foreground tabular-nums">
          {formatTokens(Math.max(item.max - bought, 0))}
          {translate('fromThePlan')}
          {formatTokens(bought)}
          {translate('fromPacksBoughtThisMonth')}
        </p>
      )}
    </div>
  )
}
