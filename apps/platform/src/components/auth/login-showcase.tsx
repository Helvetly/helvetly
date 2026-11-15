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

import { translate } from '@/lib/i18n'

// Positions in %, of a square around the center tile. Every area sits on the same neutral tile and
// its icon tells it apart; AI imports keep Heidi's colour.
const TILES: { icon: LucideIcon; label: string; x: number; y: number; heidi?: true }[] = [
  { icon: ReceiptText, label: translate('invoices'), x: 10, y: 10 },
  { icon: Building2, label: translate('clients'), x: 50, y: 10 },
  { icon: Wallet, label: translate('expenses'), x: 90, y: 10 },
  { icon: FileText, label: translate('documents'), x: 10, y: 50 },
  { icon: CreditCard, label: translate('billing'), x: 90, y: 50 },
  { icon: CalendarClock, label: translate('scheduledActions'), x: 10, y: 90 },
  { icon: Sparkles, label: translate('aiImports'), x: 50, y: 90, heidi: true },
  { icon: Users, label: translate('team'), x: 90, y: 90 },
]

const EDGES = [
  [10, 10, 90, 10],
  [90, 10, 90, 90],
  [90, 90, 10, 90],
  [10, 90, 10, 10],
  ...TILES.map(({ x, y }) => [50, 50, x, y]),
]

/** The decorative right half of /login: Helvetly's areas around one hub. */
export function LoginShowcase({ className }: { className?: string }) {
  return (
    <aside
      aria-hidden
      className={cn(
        'relative isolate flex flex-col items-center justify-center gap-16 overflow-hidden rounded-2xl border bg-muted/70 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:14px_14px] p-10',
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
      <div className="relative aspect-square w-full max-w-[22rem]">
        {/* A soft light centred on the logo, the hub of the network. */}
        <div className="absolute -inset-[30%] -z-10 bg-[radial-gradient(closest-side,var(--color-brand-surface),transparent)] opacity-70 dark:bg-[radial-gradient(closest-side,var(--color-brand),transparent)] dark:opacity-15" />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full text-brand/25 dark:text-brand/20"
        >
          {EDGES.map(([x1, y1, x2, y2]) => (
            <line
              key={`${x1}-${y1}-${x2}-${y2}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <Logo className="absolute top-1/2 left-1/2 size-20 -translate-1/2 rounded-2xl shadow-lg shadow-brand/30" />
        {TILES.map(({ icon: Icon, label, x, y, heidi }) => (
          <span
            key={label}
            title={label}
            style={{ left: `${x}%`, top: `${y}%` }}
            className={cn(
              'absolute flex size-12 -translate-1/2 items-center justify-center rounded-xl shadow-sm',
              heidi ? 'bg-heidi-soft text-heidi' : 'border bg-card text-muted-foreground',
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
        ))}
      </div>
    </aside>
  )
}
