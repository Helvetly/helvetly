'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { ArrowUp, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { useAIApproval } from '@/components/ai/ai-approval'
import { inputClass } from '@/components/clients/fields'
import { aiWrite, aiWriteError, type AIWriteAction, type AIWriteField } from '@/lib/ai-write'
import { translate } from '@/lib/i18n'

const QUICK: { action: Exclude<AIWriteAction, 'draft' | 'custom'>; label: () => string }[] = [
  { action: 'improve', label: () => translate('aiWriteImprove') },
  { action: 'shorten', label: () => translate('aiWriteShorten') },
  { action: 'formal', label: () => translate('aiWriteFormal') },
]

/**
 * Write with AI beside a description: Heidi drafts one from the rest of the form when the field is empty, or
 * improves, shortens or rewrites what is there. The text is shown first; nothing changes until Replace or Insert.
 */
export function AIWrite({
  field,
  text,
  maxLength,
  context,
  onApply,
  className,
}: {
  field: AIWriteField
  /** The field's current text. */
  text: string
  maxLength: number
  /** Other values of the form the text is about (name, price, client…); empty ones are left out. */
  context: Record<string, string | undefined>
  onApply: (text: string) => void
  className?: string
}) {
  const { ensure } = useAIApproval()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [last, setLast] = useState<{ action: AIWriteAction; instruction?: string } | null>(null)
  const empty = text.trim() === ''
  const write = useMutation({
    mutationFn: (request: { action: AIWriteAction; instruction?: string }) =>
      aiWrite({
        field,
        action: request.action,
        text,
        instruction: request.instruction,
        max_length: maxLength,
        context: Object.fromEntries(
          Object.entries(context).filter((entry): entry is [string, string] =>
            Boolean(entry[1]?.trim()),
          ),
        ),
      }),
  })
  const run = async (action: AIWriteAction, extra?: string) => {
    if (!(await ensure())) return
    const request = { action, ...(extra ? { instruction: extra } : {}) }
    setLast(request)
    write.mutate(request)
  }
  const ask = () => {
    const said = instruction.trim()
    if (!said) return
    void run(empty ? 'draft' : 'custom', said)
  }
  const close = () => {
    setOpen(false)
    write.reset()
    setInstruction('')
  }
  const apply = (next: string) => {
    onApply(next.slice(0, maxLength))
    close()
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn('-ml-1.5 gap-1 text-heidi hover:text-heidi', className)}
        >
          <HeidiSparkle />
          {translate('aiWriteButton')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[min(400px,calc(100vw-2rem))] gap-3 p-3">
        {write.data !== undefined ? (
          <>
            <p className="text-caption font-medium text-muted-foreground">
              {translate('aiWriteSuggestion')}
            </p>
            <p className="max-h-60 overflow-y-auto rounded-lg bg-heidi-soft/50 p-3 text-body-sm whitespace-pre-wrap">
              {write.data}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => apply(write.data)}>
                {empty ? translate('aiWriteUse') : translate('aiWriteReplace')}
              </Button>
              {!empty && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => apply(`${text.trimEnd()}\n${write.data}`)}
                >
                  {translate('aiWriteInsert')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={write.isPending || !last}
                onClick={() => last && void run(last.action, last.instruction)}
              >
                <RotateCcw />
                {translate('aiWriteAgain')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-body-sm font-medium">
              <HeidiSparkle animated={write.isPending} />
              {write.isPending
                ? translate('aiWriteWriting')
                : empty
                  ? translate('aiWriteDraftTitle')
                  : translate('aiWriteEditTitle')}
            </p>
            {empty ? (
              <Button
                type="button"
                size="sm"
                className="justify-self-start"
                disabled={write.isPending}
                onClick={() => void run('draft')}
              >
                {translate('aiWriteDraft')}
              </Button>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((quick) => (
                  <Button
                    key={quick.action}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={write.isPending}
                    onClick={() => void run(quick.action)}
                  >
                    {quick.label()}
                  </Button>
                ))}
              </div>
            )}
            <form
              className="relative"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                ask()
              }}
            >
              <input
                aria-label={translate('aiWriteInstruction')}
                value={instruction}
                maxLength={300}
                disabled={write.isPending}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={empty ? translate('aiWriteDraftHint') : translate('aiWriteEditHint')}
                className={cn(inputClass, 'h-9 pr-10 text-body-sm')}
              />
              <Button
                type="submit"
                size="icon-xs"
                aria-label={translate('aiWriteSend')}
                disabled={write.isPending || !instruction.trim()}
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
              >
                <ArrowUp />
              </Button>
            </form>
            {write.error && (
              <Callout
                role="alert"
                tone="danger"
                className="text-body-sm"
                actions={
                  aiWriteError(write.error).retry &&
                  last && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => void run(last.action, last.instruction)}
                    >
                      {translate('tryAgain')}
                    </Button>
                  )
                }
              >
                {aiWriteError(write.error).message}
              </Callout>
            )}
            <p className="text-caption text-muted-foreground">{translate('aiWriteNote')}</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
