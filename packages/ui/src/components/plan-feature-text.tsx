import type { FeatureLine } from '@helvetly/ui/lib/plan-features'

/** A plan line's words: its amount first, in bold ("∞" read out as "Unlimited"), then what it is. */
export function PlanFeatureText({ line, className }: { line: FeatureLine; className?: string }) {
  if (line.amount === undefined) return <span className={className}>{line.label}</span>
  return (
    <span className={className}>
      <strong className="font-semibold tabular-nums">
        {line.spoken ? (
          <>
            {/* Inter draws ∞ at the height of a lowercase letter: a little larger, it reads as a figure. */}
            <span aria-hidden className="text-[1.2em] leading-none">
              {line.amount}
            </span>
            <span className="sr-only">{line.spoken}</span>
          </>
        ) : (
          line.amount
        )}
      </strong>{' '}
      {line.label}
    </span>
  )
}
