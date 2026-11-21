import type { FeatureLine } from '@helvetly/ui/lib/plan-features'

/** A plan allowance in bold: "300", "5 GB", or "∞" read out as `spoken` ("Unlimited"). */
export function PlanAmount({ amount, spoken }: { amount: string; spoken?: string }) {
  return (
    <strong className="font-semibold tabular-nums">
      {spoken ? (
        <>
          {/* Inter draws ∞ at the height of a lowercase letter: a little larger, it reads as a figure. */}
          <span aria-hidden className="text-[1.2em] leading-none">
            {amount}
          </span>
          <span className="sr-only">{spoken}</span>
        </>
      ) : (
        amount
      )}
    </strong>
  )
}

/** A plan line's words: its amount first, in bold, then what it is. */
export function PlanFeatureText({ line, className }: { line: FeatureLine; className?: string }) {
  if (line.amount === undefined) return <span className={className}>{line.label}</span>
  return (
    <span className={className}>
      <PlanAmount amount={line.amount} spoken={line.spoken} /> {line.label}
    </span>
  )
}
