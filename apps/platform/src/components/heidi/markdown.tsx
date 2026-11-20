import { localizedHref } from '@helvetly/i18n'
import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'
import { Children, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const WORD_TONES: Record<string, Tone> = STATUS_TONES.word

const NUMBER = /^[-+]?(CHF\s?)?[\d'’.,\s]+%?$/

const textOf = (children: ReactNode) =>
  Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('')

/**
 * While an answer streams, half-written markdown must not flash as raw syntax: an unclosed
 * emphasis or code span is closed, and a table row still being written waits for its end.
 */
export function closeOpenMarkdown(text: string) {
  const lines = text.split('\n')
  const last = lines.at(-1) ?? ''
  if (last.trimStart().startsWith('|') && !last.trimEnd().endsWith('|')) lines.pop()
  let safe = lines.join('\n')
  if ((safe.match(/\*\*/g)?.length ?? 0) % 2) safe += '**'
  if ((safe.match(/`/g)?.length ?? 0) % 2) safe += '`'
  return safe
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="mt-4 mb-1.5 font-semibold text-foreground first:mt-0">{children}</p>
}

const components: Components = {
  p: ({ children }) => <p className="my-2.5 text-pretty first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <Heading>{children}</Heading>,
  h2: ({ children }) => <Heading>{children}</Heading>,
  h3: ({ children }) => <Heading>{children}</Heading>,
  h4: ({ children }) => <Heading>{children}</Heading>,
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1.5 pl-5 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1.5 pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="pl-1 marker:text-muted-foreground/70 [&>ol]:my-1 [&>ul]:my-1">{children}</li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-heidi/40 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  // Model text may follow instructions planted in a file: an image would load (and leak its URL) without a click.
  img: ({ alt }) => <>{alt}</>,
  a: ({ children, href }) => (
    <a
      href={localizedHref(href)}
      rel="noopener noreferrer"
      className="underline decoration-heidi/40 underline-offset-2 hover:decoration-heidi"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    const text = textOf(children)
    const tone = WORD_TONES[text.toLowerCase()]
    // An inline code span holding a status word is a status, shown like everywhere else.
    if (!className && tone)
      return <Badge tone={tone}>{text.charAt(0).toUpperCase() + text.slice(1)}</Badge>
    return (
      <code className="rounded-[4px] bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-muted p-3 text-[13px] [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border bg-card first:mt-0 last:mb-0">
      <table className="w-full text-[13.5px] tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b bg-muted/40 text-left text-caption text-muted-foreground">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y">{children}</tbody>,
  th: ({ children, style }) => (
    <th
      className={cn(
        'h-8 px-3 font-medium whitespace-nowrap',
        style?.textAlign === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      className={cn(
        'h-9 px-3 whitespace-nowrap',
        (style?.textAlign === 'right' || NUMBER.test(textOf(children).trim())) && 'text-right',
      )}
    >
      {children}
    </td>
  ),
}

/** Heidi's answer as markdown, safe to render while it is still streaming. */
export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {streaming ? closeOpenMarkdown(text) : text}
    </ReactMarkdown>
  )
})
