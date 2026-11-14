'use client'

import { Button } from '@helvetly/ui/components/button'
import { Sparkles } from 'lucide-react'
import { useRef } from 'react'

import { toastError } from '@/components/billing/upgrade-prompt'
import { type Billing, formatPrice, formatTokens, useBuyAITokens } from '@/lib/billing'

import { BillingCard } from './billing-card'

/**
 * Extra AI tokens for Heidi and the AI import: what the month has used of the plan's allowance and
 * of the packs bought, and a pack to buy. Shown to a manager of a workspace on a plan when packs are
 * on sale.
 */
export function AITokenPacks({ billing }: { billing: Billing }) {
  const buy = useBuyAITokens()
  const opening = useRef(false)
  const item = billing.usage.find((u) => u.limit === 'ai_tokens_per_month')
  if (billing.ai_packs.length === 0 || !item) return null

  const choose = (tokens: number) => {
    if (opening.current) return
    opening.current = true
    buy.mutate(
      { tokens },
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
      description="Heidi and the AI import use these. A pack is used after the plan’s monthly tokens; what is left lapses at the end of the month."
    >
      <div className="grid gap-4 px-5 pb-5">
        <p className="text-body-sm text-muted-foreground" data-slot="ai-tokens-used">
          {formatTokens(item.used)} of {item.max === null ? 'unlimited' : formatTokens(item.max)}{' '}
          used this month
          {billing.ai_tokens_bought > 0 && ` (${formatTokens(billing.ai_tokens_bought)} bought)`}
        </p>
        <div className="grid gap-3 @md:grid-cols-3">
          {billing.ai_packs.map((pack) => (
            <div
              key={pack.tokens}
              className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
            >
              <div className="grid">
                <span className="flex items-center gap-1.5 text-body font-medium">
                  <Sparkles aria-hidden className="size-4 text-muted-foreground" />
                  {formatTokens(pack.tokens)} tokens
                </span>
                <span className="text-body-sm text-muted-foreground">
                  {formatPrice({ amount: pack.amount, currency: pack.currency })} once
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={buy.isPending}
                onClick={() => choose(pack.tokens)}
                aria-label={`Buy ${formatTokens(pack.tokens)} AI tokens`}
              >
                Buy
              </Button>
            </div>
          ))}
        </div>
      </div>
    </BillingCard>
  )
}
