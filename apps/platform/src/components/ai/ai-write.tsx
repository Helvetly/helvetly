'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { ArrowUp, Info, RotateCcw, X } from 'lucide-react'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useAIApproval } from '@/components/ai/ai-approval'
import { AIBudgetTip } from '@/components/ai/ai-budget'
import { inputClass } from '@/components/clients/fields'
import { useAI } from '@/lib/ai'
import {
  aiWrite,
  aiWriteError,
  type AIWriteAction,
  type AIWriteField,
  type AIWriteLanguage,
} from '@/lib/ai-write'
import { translate } from '@/lib/i18n'

const PRESETS: {
  action: Exclude<AIWriteAction, 'draft' | 'custom' | 'translate'>
  label: () => string
}[] = [
  { action: 'improve', label: () => translate('aiWriteImprove') },
  { action: 'shorten', label: () => translate('aiWriteShorten') },
  { action: 'formal', label: () => translate('aiWriteFormal') },
  { action: 'friendly', label: () => translate('aiWriteFriendly') },
]

const LANGUAGE_NAMES: Record<AIWriteLanguage, () => string> = {
  de: () => translate('deutsch'),
  fr: () => translate('franAis'),
  it: () => translate('italiano'),
  en: () => translate('english'),
}

type Request = {
  action: AIWriteAction
  text: string
  instruction?: string
  language?: AIWriteLanguage
}

/**
 * Write with AI inside a description or message (TextareaBox): one panel anchored to the field. Heidi drafts from the
 * rest of the form when the field is empty, or changes what is there; the proposal grows into the same panel with the
 * prompt kept below to refine it. Nothing changes until Use this, and a toast offers Undo after it.
 */
export function AIWrite({
  field,
  text,
  maxLength,
  context,
  language,
  onApply,
  className,
}: {
  field: AIWriteField
  /** The field's current text. */
  text: string
  maxLength: number
  /** Other values of the form the text is about (name, price, client…); empty ones are left out. */
  context: Record<string, string | undefined>
  /** The reader's language, when it may differ from the text's: offers to translate into it. */
  language?: AIWriteLanguage
  onApply: (text: string) => void
  className?: string
}) {
  const { ensure } = useAIApproval()
  const ai = useAI('heidi')
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<string | null>(null)
  const [last, setLast] = useState<Request | null>(null)
  const prompt = useRef<HTMLInputElement>(null)
  const empty = text.trim() === ''
  const write = useMutation({
    mutationFn: (request: Request) =>
      aiWrite({
        field,
        ...request,
        max_length: maxLength,
        context: Object.fromEntries(
          Object.entries(context).filter((entry): entry is [string, string] =>
            Boolean(entry[1]?.trim()),
          ),
        ),
      }),
  })
  const run = async (request: Request) => {
    if (write.isPending || !(await ensure())) return
    setLast(request)
    prompt.current?.focus() // a suggestion or Try again turns inactive while Heidi writes; the prompt keeps focus
    // Per-call callbacks: a late answer after the panel closed (write.reset) is dropped.
    write.mutate(request, {
      onSuccess: (answer) => {
        setProposal(answer)
        setInstruction('')
      },
    })
  }
  const ask = () => {
    const said = instruction.trim()
    if (!said) return
    // With a proposal on screen the words refine it; otherwise they change (or draft) the field's text.
    const base = proposal ?? text
    void run({ action: base.trim() ? 'custom' : 'draft', text: base, instruction: said })
  }
  const close = () => {
    setOpen(false)
    write.reset()
    setInstruction('')
    setProposal(null)
    setLast(null)
  }
  const use = (next: string) => {
    const before = text
    onApply(next.slice(0, maxLength))
    close()
    toast(translate('aiWriteUsed'), {
      action: { label: translate('undo'), onClick: () => onApply(before) },
    })
  }
  const grown = proposal !== null || write.isPending
  const failure = write.error ? aiWriteError(write.error) : null
  if (!ai.available) return null
  const button = (
    <Button type="button" variant="ai" size="xs" className={className} disabled={ai.usedUp}>
      <HeidiSparkle />
      {translate('aiWriteButton')}
    </Button>
  )
  if (ai.usedUp)
    return (
      <AIBudgetTip usedUp pool="heidi">
        {button}
      </AIBudgetTip>
    )

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={16}
        aria-label={translate('aiWriteButton')}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          prompt.current?.focus()
        }}
        className={cn(
          'block p-0 transition-[width] duration-200 ease-out motion-reduce:transition-none',
          grown ? 'w-[min(460px,calc(100vw-2rem))]' : 'w-[min(380px,calc(100vw-2rem))]',
        )}
      >
        <Grow>
          <div className="grid gap-3 p-3">
            <div className="flex items-center gap-1.5">
              <HeidiSparkle animated={write.isPending} />
              <p className="text-body-sm font-medium">{translate('aiWriteButton')}</p>
              <Hint label={translate('aiWriteNote')}>
                <Info />
              </Hint>
              <Hint label={translate('close')} onClick={close} className="ml-auto">
                <X />
              </Hint>
            </div>

            {write.isPending ? (
              <Loader
                label={translate('aiWriteWriting')}
                className="min-h-20 rounded-xl bg-heidi-soft/50 dark:bg-heidi/10"
              />
            ) : (
              proposal !== null && (
                <div className="grid gap-2">
                  <p
                    aria-label={translate('aiWriteSuggestion')}
                    className="max-h-64 overflow-y-auto rounded-xl bg-heidi-soft/50 p-3 text-body-sm leading-relaxed whitespace-pre-wrap dark:bg-heidi/10"
                  >
                    {proposal}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" onClick={() => use(proposal)}>
                      {translate('aiWriteUse')}
                    </Button>
                    {last && (
                      <Hint label={translate('aiWriteAgain')} onClick={() => void run(last)}>
                        <RotateCcw />
                      </Hint>
                    )}
                  </div>
                </div>
              )
            )}

            {failure && (
              <Callout
                role="alert"
                tone="danger"
                className="text-body-sm"
                actions={
                  failure.retry &&
                  last && (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => void run(last)}
                    >
                      {translate('tryAgain')}
                    </Button>
                  )
                }
              >
                {failure.message}
              </Callout>
            )}

            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                ask()
              }}
            >
              <div className="relative">
                <input
                  ref={prompt}
                  aria-label={translate('aiWriteInstruction')}
                  value={instruction}
                  maxLength={300}
                  // Read-only, not disabled, while Heidi writes: focus stays here for the next refinement.
                  readOnly={write.isPending}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={
                    proposal !== null
                      ? translate('aiWriteRefineHint')
                      : empty
                        ? translate('aiWriteDraftHint')
                        : translate('aiWriteEditHint')
                  }
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
              </div>
              {proposal === null && (
                <div className="flex flex-wrap gap-1">
                  {(empty
                    ? [{ action: 'draft' as const, label: () => translate('aiWriteDraft') }]
                    : [
                        ...PRESETS,
                        ...(language
                          ? [
                              {
                                action: 'translate' as const,
                                label: () =>
                                  translate('aiWriteTranslate', {
                                    language: LANGUAGE_NAMES[language](),
                                  }),
                              },
                            ]
                          : []),
                      ]
                  ).map((preset) => (
                    <button
                      key={preset.action}
                      type="button"
                      disabled={write.isPending}
                      onClick={() =>
                        // The reader's language for every action: the email is written in it.
                        void run({ action: preset.action, text, ...(language ? { language } : {}) })
                      }
                      className="rounded-full bg-muted px-2.5 py-0.5 text-caption text-muted-foreground transition-colors outline-none hover:bg-heidi-soft hover:text-heidi-ink focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:hover:bg-heidi/15 dark:hover:text-foreground"
                    >
                      {preset.label()}
                    </button>
                  ))}
                </div>
              )}
            </form>
          </div>
        </Grow>
      </PopoverContent>
    </Popover>
  )
}

/** Animates its height to its content's, so the panel grows (and shrinks) smoothly as the proposal comes and goes. */
function Grow({ children }: { children: ReactNode }) {
  const [height, setHeight] = useState<number>()
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      style={{ height }}
      className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
    >
      <div ref={measure}>{children}</div>
    </div>
  )
}

/** A small icon button whose name is its tooltip. */
function Hint({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
          className={cn('text-muted-foreground', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
