'use client'

import { Button } from '@helvetly/ui/components/button'
import type { LucideIcon } from 'lucide-react'
import { Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { translate } from '@/lib/i18n'

import { PLANS_HREF, type FeatureLock } from './feature-lock'

/**
 * A feature the plan lacks, shown as an invitation where the feature would be: what it gives, a small preview, a few
 * benefits and the way to the plan that has it.
 */
export function UpsellCard({
  lock,
  title,
  pitch,
  preview,
  benefits,
}: {
  lock: NonNullable<FeatureLock>
  title: string
  pitch: ReactNode
  preview?: ReactNode
  benefits: { icon: LucideIcon; text: string }[]
}) {
  return (
    <section
      data-slot="upsell-card"
      aria-label={title}
      className="grid gap-4 rounded-xl border border-brand-solid/20 bg-brand-surface/40 p-4 sm:p-5"
    >
      <div className="grid gap-1.5">
        {lock.plan && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-background/70 px-2 text-caption leading-5 font-medium text-brand ring-1 ring-brand-solid/20">
            <Sparkles aria-hidden className="size-3" />
            {translate('includedInPlan', { plan: lock.plan.name })}
          </span>
        )}
        <h4 className="text-title-sm font-semibold text-balance">{title}</h4>
        <p className="text-body-sm text-pretty text-muted-foreground">{pitch}</p>
      </div>
      {preview}
      <ul className="grid gap-2 sm:grid-cols-3 sm:gap-3">
        {benefits.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2 text-body-sm">
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-background/70 text-brand ring-1 ring-brand-solid/15">
              <Icon aria-hidden className="size-3" />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild size="sm">
          <Link href={PLANS_HREF}>
            {lock.plan ? translate('upgradeTo', { name: lock.plan.name }) : translate('upgrade')}
          </Link>
        </Button>
        <Link
          href={`${PLANS_HREF}#compare`}
          className="text-body-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {translate('comparePlans')}
        </Link>
      </div>
    </section>
  )
}
