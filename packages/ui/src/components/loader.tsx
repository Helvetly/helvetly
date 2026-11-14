import { cn } from 'cn'
import { LoaderCircle } from 'lucide-react'

/**
 * The one loading state, instead of placeholder shapes. `page` fills the panel and says "Loading…";
 * `inline` centres a small spinner in the card, section, drawer or table area it stands in for.
 * It fades in only after a beat, so a quick load never flashes it.
 */
function Loader({
  size = 'inline',
  label = 'Loading',
  className,
  ...props
}: Omit<React.ComponentProps<'output'>, 'children'> & {
  size?: 'page' | 'inline'
  label?: string
}) {
  return (
    <output
      data-slot="loader"
      aria-label={label}
      aria-busy="true"
      className={cn(
        'flex animate-in items-center justify-center gap-2 text-body-sm text-muted-foreground duration-300 fade-in-0 [animation-delay:200ms] [animation-fill-mode:both]',
        size === 'page' ? 'flex-1' : 'min-h-24 w-full',
        className,
      )}
      {...props}
    >
      <LoaderCircle
        aria-hidden
        className={cn(
          'animate-spin text-brand-solid motion-reduce:animate-none',
          size === 'page' ? 'size-5' : 'size-4',
        )}
      />
      {size === 'page' && 'Loading…'}
    </output>
  )
}

export { Loader }
