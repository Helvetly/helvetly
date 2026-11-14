import { cn } from '@helvetly/ui/lib/utils'

/** Two alpine peaks; the back one translucent. Shared by the app icon and the favicons. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M9.5 18 14.75 8.5 20.5 18Z" opacity=".5" />
      <path d="M3.5 18 9 9.25 14.75 18Z" />
    </svg>
  )
}

/** The Helvetly app icon: a brand-teal rounded tile with the mark. Size it with `className`. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-[28%] bg-linear-to-br from-logo-from to-logo-to text-white shadow-sm ring-1 ring-black/10 ring-inset',
        className,
      )}
    >
      <LogoMark className="size-[62%]" />
    </span>
  )
}
