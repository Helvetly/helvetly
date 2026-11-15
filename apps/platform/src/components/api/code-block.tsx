'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { ArrowUpRight, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { docsUrl } from '@/lib/docs'
import { translate } from '@/lib/i18n'

/** Several lines to paste (a config file, a command) in mono, with a copy button in the corner. */
export function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <section aria-label={label} className="relative min-w-0 rounded-lg border bg-muted/50">
      {/* Long lines wrap rather than scroll, so nothing hides under the copy button. */}
      <pre className="py-2.5 pr-11 pl-3 font-mono text-caption leading-relaxed break-all whitespace-pre-wrap">
        <code>{value}</code>
      </pre>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={translate('copy2', { label: label })}
            className="absolute top-1 right-1"
            onClick={() =>
              void navigator.clipboard.writeText(value).then(
                () => toast(translate('copied', { label: label })),
                () => toast.error(translate('couldNotCopySelectTheTextAndCopyIt')),
              )
            }
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {translate('copy')}
          {label.toLowerCase()}
        </TooltipContent>
      </Tooltip>
    </section>
  )
}

/** A link to a page of the developer docs, which open in a new tab. */
export function DocsLink({
  path,
  className,
  children,
}: {
  path?: string
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={localizedHref(docsUrl(path))}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-0.5 font-medium text-foreground underline decoration-foreground/30 underline-offset-[3px] transition-colors hover:decoration-foreground',
        className,
      )}
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">{translate('opensInANewTab2')}</span>
    </a>
  )
}
