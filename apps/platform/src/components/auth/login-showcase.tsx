import { Logo } from '@helvetly/ui/components/logo'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  ReceiptText,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { translate } from '@/lib/i18n'

import styles from './login-showcase.module.css'

// Positions in %, clockwise from the top left, so the sparks run round the hub in reading order.
// Every area sits on the same neutral tile; AI imports keep Heidi's colour.
const TILES: { icon: LucideIcon; label: string; x: number; y: number; heidi?: true }[] = [
  { icon: ReceiptText, label: translate('invoices'), x: 16, y: 14 },
  { icon: Building2, label: translate('clients'), x: 50, y: 14 },
  { icon: Wallet, label: translate('expenses'), x: 84, y: 14 },
  { icon: CreditCard, label: translate('billing'), x: 84, y: 50 },
  { icon: Users, label: translate('team'), x: 84, y: 86 },
  { icon: Sparkles, label: translate('aiImports'), x: 50, y: 86, heidi: true },
  { icon: CalendarClock, label: translate('scheduledActions'), x: 16, y: 86 },
  { icon: FileText, label: translate('documents'), x: 16, y: 50 },
]

/** The decorative right half of /login: Helvetly's areas around Heidi, who points you to them. */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        'relative isolate flex flex-col items-center justify-center gap-12 overflow-hidden rounded-2xl border bg-muted/70 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:14px_14px] p-10',
        className,
      )}
    >
      <div className="grid max-w-md gap-3 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          {translate('runYourCompany')}
          <span className="text-primary">{translate('inOnePlace')}</span>
        </h2>
        <p className="text-sm text-balance text-muted-foreground">
          {translate('invoicesExpensesClientsAndDocumentsSideBySideWith')}
        </p>
      </div>
      <div className="relative aspect-square w-full max-w-[24rem]">
        {/* A soft light centred on the logo, the hub of the network. */}
        <div
          aria-hidden
          className="absolute -inset-[30%] -z-10 bg-[radial-gradient(closest-side,var(--color-brand-surface),transparent)] opacity-70 dark:bg-[radial-gradient(closest-side,var(--color-brand),transparent)] dark:opacity-15"
        />
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          {TILES.map(({ x, y, label }, i) => (
            <g key={label} style={{ '--i': i } as CSSProperties}>
              <line
                x1={50}
                y1={50}
                x2={x}
                y2={y}
                className="stroke-brand/25 dark:stroke-brand/20"
                strokeWidth="1.25"
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={50}
                y1={50}
                x2={x}
                y2={y}
                pathLength={1}
                className={cn(styles.spark, 'stroke-brand')}
                strokeWidth="0.5"
                strokeLinecap="round"
              />
            </g>
          ))}
        </svg>
        <div
          className={cn(
            styles.hub,
            'absolute top-1/2 left-1/2 grid -translate-1/2 justify-items-center gap-2',
          )}
        >
          <Logo className="size-16 rounded-2xl shadow-lg shadow-brand/30" />
          <span className="flex items-center gap-1 rounded-full bg-heidi-soft px-2 py-0.5 text-xs font-medium text-heidi-ink">
            <Sparkles className="size-3" aria-hidden />
            {translate('heidi')}
          </span>
        </div>
        <ul>
          {TILES.map(({ icon: Icon, label, x, y, heidi }, i) => (
            <li
              key={label}
              style={{ left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties}
              className="absolute grid w-24 -translate-1/2 justify-items-center gap-1.5"
            >
              <span
                className={cn(
                  styles.tile,
                  'flex size-12 items-center justify-center rounded-xl border shadow-sm',
                  heidi ? 'bg-heidi-soft text-heidi' : 'bg-card text-muted-foreground',
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-center text-xs leading-tight text-balance text-muted-foreground">
                {label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
