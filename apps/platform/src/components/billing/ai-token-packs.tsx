'use client'

import { Button } from '@helvetly/ui/components/button'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Meter } from '@helvetly/ui/components/meter'
import { cn } from '@helvetly/ui/lib/utils'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import {
  type AIPack,
  type Billing,
  formatPrice,
  formatTokens,
  meterState,
  type UsageItem,
  useBuyAITokens,
} from '@/lib/billing'

import { BillingCard } from './billing-card'

/** What a pack costs per million tokens, in the currency's minor unit. */
const perMillion = (pack: AIPack) => Math.round((pack.amount * 1_000_000) / pack.tokens)

/** The pack with the lowest price per token, when the packs differ at all. */
export function bestValue(packs: AIPack[]): AIPack | undefined {
  const rates = packs.map(perMillion)
  const low = Math.min(...rates)
  return low < Math.max(...rates) ? packs[rates.indexOf(low)] : undefined
}

/**
 * Extra AI tokens for Heidi and the AI import: how much of the month's allowance (the plan's plus the
 * packs bought) is used, and a pack to buy. Shown to a manager of a workspace on a plan when packs are
 * on sale.
 */
export function AITokenPacks({ billing }: { billing: Billing }) {
  const buy = useBuyAITokens()
  const opening = useRef(false)
  const group = useId()
  const [chosen, setChosen] = useState<number | null>(null)
  const item = billing.usage.find((u) => u.limit === 'ai_tokens_per_month')
  const [first] = billing.ai_packs
  if (!first || !item) return null

  const best = bestValue(billing.ai_packs)
  const pack = billing.ai_packs.find((p) => p.tokens === chosen) ?? first
  const price = (amount: number) => formatPrice({ amount, currency: pack.currency })

  const purchase = () => {
    if (opening.current) return
    opening.current = true
    buy.mutate(
      { tokens: pack.tokens },
      {
        onSuccess: ({ url }) => window.location.assign(url),
        onError: toastError,
        onSettled: () => {
          opening.current = false
        },
      },
    )
  }

  return (
    <BillingCard
      id="ai-tokens"
      title="AI tokens"
      description={
        <span className="inline-flex items-center gap-1.5">
          Used by Heidi and the AI import.
          <HelpTip label="AI tokens">
            Each month starts with the tokens your plan includes. A pack adds to them and is used
            once they run out. Tokens left at the end of the month lapse.
          </HelpTip>
        </span>
      }
    >
      <div className="grid gap-5 px-5 pt-4 pb-5">
        <TokenUsage item={item} bought={billing.ai_tokens_bought} />
        <fieldset className="grid gap-2.5">
          <legend className="mb-2.5 text-body-sm font-medium">Add a pack</legend>
          <div className="grid gap-2 @md:grid-cols-3">
            {billing.ai_packs.map((option) => (
              <label
                key={option.tokens}
                data-slot="ai-pack"
                className="group relative grid cursor-pointer grid-cols-[1fr_auto] items-start gap-x-3 gap-y-0.5 rounded-xl border bg-card px-4 py-3 transition-colors duration-150 hover:border-foreground/20 has-checked:border-brand-solid/45 has-checked:bg-brand-surface/40 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
              >
                <input
                  type="radio"
                  name={group}
                  value={option.tokens}
                  checked={option === pack}
                  disabled={buy.isPending}
                  onChange={() => setChosen(option.tokens)}
                  aria-label={`${formatTokens(option.tokens)} tokens for ${price(option.amount)}`}
                  // Covers the whole card, so a click anywhere on it chooses the pack.
                  className="absolute inset-0 cursor-pointer appearance-none rounded-xl opacity-0"
                />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-medium">
                  {formatTokens(option.tokens)} tokens
                  {option === best && (
                    <span className="rounded-full bg-success-surface px-2 py-px text-caption font-medium text-success">
                      Best value
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="mt-0.5 size-4 rounded-full border border-foreground/25 bg-card transition-[border] duration-150 group-has-checked:border-[5px] group-has-checked:border-brand-solid"
                />
                <span className="col-span-2 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                  <span className="text-body-sm text-foreground">{price(option.amount)}</span>
                  <span className="text-caption text-muted-foreground">
                    {price(perMillion(option))} per 1 M
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col-reverse gap-3 @md:flex-row @md:items-center @md:justify-between">
          <p className="text-caption text-pretty text-muted-foreground">
            A one-off payment through Stripe, not a subscription.
          </p>
          <Button
            disabled={buy.isPending}
            aria-busy={buy.isPending}
            onClick={purchase}
            className="w-full @md:w-auto"
          >
            {buy.isPending ? (
              <LoaderCircle data-icon="inline-start" aria-hidden className="animate-spin" />
            ) : (
              <Sparkles data-icon="inline-start" aria-hidden />
            )}
            Buy {formatTokens(pack.tokens)} tokens · {price(pack.amount)}
          </Button>
        </div>
      </div>
    </BillingCard>
  )
}

const NOTE = {
  near: { text: 'Almost used up', className: 'text-warning' },
  full: { text: 'Used up', className: 'text-destructive' },
}

/** "1.2 M of 6 M used this month" over the shared meter, and how the allowance is made up. */
function TokenUsage({ item, bought }: { item: UsageItem; bought: number }) {
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
            of {max ?? 'unlimited'} used this month
          </span>
        </p>
        {note && (
          <span className={cn('text-caption font-medium', note.className)}>{note.text}</span>
        )}
      </div>
      {item.max === null ? (
        <div aria-hidden className="h-1.5 rounded-full bg-muted" />
      ) : (
        <Meter label={`AI tokens: ${used} of ${max} used`} value={item.used} max={item.max} />
      )}
      {bought > 0 && item.max !== null && (
        <p className="text-caption text-muted-foreground tabular-nums">
          {formatTokens(Math.max(item.max - bought, 0))} from the plan + {formatTokens(bought)} from
          packs bought this month
        </p>
      )}
    </div>
  )
}
