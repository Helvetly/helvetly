'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'

import { useAIApproval } from '@/components/ai/ai-approval'
import { AIBudgetTip } from '@/components/ai/ai-budget'
import { useAI } from '@/lib/ai'
import { aiWriteError } from '@/lib/ai-write'
import { request } from '@/lib/api'
import { EMAIL_LANGUAGES, type EmailKind, type EmailLanguage } from '@/lib/email-templates'
import { translate } from '@/lib/i18n'

export type TemplateTexts = Record<EmailLanguage, { subject: string; body: string }>

/** POST /api/v1/email-templates/{kind}/ai-write: every language at once, checked against the kind's variables. */
export const writeTemplates = async (
  kind: EmailKind,
  instruction: string,
  current: TemplateTexts,
): Promise<TemplateTexts> =>
  (
    await request<{ data: TemplateTexts }>(`/email-templates/${kind}/ai-write`, {
      method: 'POST',
      json: { instruction, current },
    })
  ).data

/** Lines of before and after in order, each kept, removed or added (a longest-common-subsequence diff). */
export function lineDiff(before: string, after: string) {
  const a = before.split('\n')
  const b = after.split('\n')
  // common[i * width + j]: the longest common run of a[i..] and b[j..]
  const width = b.length + 1
  const common = Array.from({ length: (a.length + 1) * width }, () => 0)
  const at = (i: number, j: number) => common[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  // key: where the line sits in before (r) and after (a), unique within one diff.
  const out: { kind: 'same' | 'removed' | 'added'; text: string; key: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] ?? '', key: `s${i}-${j}` })
      i++
      j++
    } else if (j < b.length && (i === a.length || at(i, j + 1) >= at(i + 1, j))) {
      out.push({ kind: 'added', text: b[j] ?? '', key: `a${j++}` })
    } else out.push({ kind: 'removed', text: a[i] ?? '', key: `r${i++}` })
  }
  return out
}

const LANGUAGE_NAMES: Record<EmailLanguage, () => string> = {
  de: () => translate('deutsch'),
  fr: () => translate('franAis'),
  it: () => translate('italiano'),
  en: () => translate('english'),
}

/** The Write with AI button of the template's message (automation pool); hidden without a model. */
export function TemplateAIButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const ai = useAI('automation')
  if (!ai.available) return null
  return (
    <AIBudgetTip usedUp={ai.usedUp} pool="automation">
      <Button
        type="button"
        variant="ai"
        size="xs"
        aria-expanded={open}
        disabled={ai.usedUp}
        onClick={onOpen}
      >
        <HeidiSparkle />
        {translate('aiWriteButton')}
      </Button>
    </AIBudgetTip>
  )
}

/**
 * Heidi writes the subject and message of every language at once, from an optional instruction; each language's
 * change shows as a line diff before Apply replaces the fields (the dialog offers Undo until Save).
 */
export function TemplateAIPanel({
  kind,
  current,
  onApply,
  onClose,
}: {
  kind: EmailKind
  current: TemplateTexts
  onApply: (texts: TemplateTexts) => void
  onClose: () => void
}) {
  const { ensure } = useAIApproval()
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState<EmailLanguage>('de')
  const write = useMutation({
    mutationFn: () => writeTemplates(kind, instruction.trim(), current),
  })
  const run = async () => {
    if (write.isPending || !(await ensure())) return
    write.mutate()
  }
  const proposal = write.data
  const failure = write.error ? aiWriteError(write.error) : null
  const shown = proposal?.[language]
  return (
    <section
      aria-label={translate('aiWriteButton')}
      className="grid gap-3 rounded-xl bg-heidi-soft/50 p-3 dark:bg-heidi/10"
    >
      <div className="flex items-center gap-1.5">
        <HeidiSparkle animated={write.isPending} />
        <p className="text-body-sm font-medium">{translate('emailTemplatesAITitle')}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('close')}
              className="ml-auto text-muted-foreground"
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{translate('close')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label={translate('emailTemplatesAIInstruction')}
          placeholder={translate('emailTemplatesAIInstructionHint')}
          value={instruction}
          maxLength={300}
          readOnly={write.isPending}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            // Enter writes here; it never submits the template form around it.
            if (event.key !== 'Enter') return
            event.preventDefault()
            void run()
          }}
        />
        <Button type="button" disabled={write.isPending} onClick={() => void run()}>
          {proposal ? translate('aiWriteAgain') : translate('emailTemplatesAIWrite')}
        </Button>
      </div>
      {write.isPending && <Loader label={translate('aiWriteWriting')} className="min-h-20" />}
      {failure && (
        <Callout role="alert" tone="danger" className="text-body-sm">
          {failure.message}
        </Callout>
      )}
      {proposal && shown && !write.isPending && (
        <div className="grid gap-2">
          <Segmented
            label={translate('emailTemplatesLanguage')}
            value={language}
            options={EMAIL_LANGUAGES.map((code) => ({
              value: code,
              label: LANGUAGE_NAMES[code](),
            }))}
            onChange={setLanguage}
          />
          <div
            aria-label={translate('emailTemplatesAIPreview', {
              language: LANGUAGE_NAMES[language](),
            })}
            className="grid max-h-64 gap-2 overflow-y-auto rounded-lg bg-background p-3 text-body-sm"
          >
            <Diff before={current[language].subject} after={shown.subject} strong />
            <Diff before={current[language].body} after={shown.body} />
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => onApply(proposal)}>
              {translate('emailTemplatesAIApply')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Diff({ before, after, strong }: { before: string; after: string; strong?: boolean }) {
  return (
    <div className={cn('grid leading-relaxed whitespace-pre-wrap', strong && 'font-medium')}>
      {lineDiff(before, after).map((line) =>
        line.kind === 'same' ? (
          <span key={line.key}>{line.text || ' '}</span>
        ) : line.kind === 'added' ? (
          <ins
            key={line.key}
            className="rounded-sm bg-success-surface px-1 text-success no-underline"
          >
            {line.text || ' '}
          </ins>
        ) : (
          <del
            key={line.key}
            className="rounded-sm px-1 text-muted-foreground line-through decoration-destructive/60"
          >
            {line.text || ' '}
          </del>
        ),
      )}
    </div>
  )
}
