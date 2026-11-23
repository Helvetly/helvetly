'use client'
import { Button } from '@helvetly/ui/components/button'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { Camera } from 'lucide-react'
import { useState } from 'react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { useAI } from '@/lib/ai'
import { canRecognize, RECEIPT_MAX_FILES } from '@/lib/expenses'
import { translate } from '@/lib/i18n'

import { ReceiptDrop, StagedReceipts } from './expense-receipts'

/** The server reads at most this many files, as the pages of one receipt. */
export const READ_MAX_PAGES = 5

/**
 * Why receipts cannot be read with AI right now, or null: the plan lacks the AI import, the server has no AI model,
 * or this month's automation allowance is used up. Approval is not a reason: it is asked on the first reading.
 */
export function useReceiptAIBlock(): string | null {
  const lock = useFeatureLock('ai_import')
  const ai = useAI()
  if (!ai.available) return translate('receiptAIUnavailable')
  if (lock) return lock.hint
  if (ai.usedUp) return translate('receiptAIPoolUsedUp')
  return null
}

type Split = 'one' | 'each'

/**
 * The first step of a new expense, in the form's own sheet: the receipt first. Continue reads it with AI (on unless
 * something blocks it) and opens the filled form; several files are one expense's pages unless the person sends
 * each to the AI import as its own draft. "Enter manually" opens the empty form.
 */
export function ExpenseStart({
  onRead,
  onContinue,
  onImport,
  onCancel,
}: {
  /** Read these files with AI as one receipt. */
  onRead: (files: File[]) => void
  /** Open the form, with these files staged (none: no receipt yet). */
  onContinue: (files: File[]) => void
  /** One draft per file, through the AI import. */
  onImport: (files: File[]) => void
  onCancel: () => void
}) {
  const blocked = useReceiptAIBlock()
  const { available } = useAI()
  const [files, setFiles] = useState<File[]>([])
  const [ai, setAI] = useState(true)
  const [split, setSplit] = useState<Split>('one')
  const readable = files.filter(canRecognize)
  const unreadable = files.length > 0 && readable.length === 0
  const aiReason = blocked ?? (unreadable ? translate('receiptAINothingReadable') : undefined)
  const reads = ai && !aiReason
  const each = split === 'each' && files.length > 1 && !blocked

  const add = (picked: File[]) =>
    setFiles((current) =>
      [
        ...current,
        ...picked.filter(
          (file) => !current.some((had) => had.name === file.name && had.size === file.size),
        ),
      ].slice(0, RECEIPT_MAX_FILES),
    )
  const next = () => {
    if (each) onImport(files)
    else if (reads) onRead(readable.slice(0, READ_MAX_PAGES))
    else onContinue(files)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 md:px-8">
        <h2 className="text-lg font-semibold">{translate('newExpense')}</h2>
        <p className="text-body-sm text-muted-foreground">{translate('expenseStartHint')}</p>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-6 md:px-8">
        <ReceiptDrop onFiles={add} />
        <Button asChild variant="outline" size="xl" className="cursor-pointer sm:hidden">
          <label>
            <Camera />
            {translate('takeAPhoto')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])]
                event.target.value = ''
                add(picked)
              }}
            />
          </label>
        </Button>
        {files.length > 0 && (
          <StagedReceipts
            files={files}
            onRemove={(file) => setFiles(files.filter((entry) => entry !== file))}
          />
        )}
        {available && (
          <SwitchRow
            id="expense-read-with-ai"
            label={
              <span className="inline-flex items-center gap-1.5">
                <HeidiSparkle />
                {translate('readWithAI')}
              </span>
            }
            description={translate('readWithAIHint', { pages: READ_MAX_PAGES })}
            checked={reads}
            disabledReason={aiReason}
            onCheckedChange={setAI}
          />
        )}
        {files.length > 1 && !blocked && (
          <div className="grid gap-1.5">
            <Segmented
              label={translate('severalFiles')}
              value={split}
              fill
              options={[
                { value: 'one', label: translate('oneExpense') },
                { value: 'each', label: translate('oneExpensePerFile') },
              ]}
              onChange={setSplit}
            />
            <p className="text-xs text-muted-foreground">
              {split === 'one' ? translate('oneExpenseHint') : translate('oneExpensePerFileHint')}
            </p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3 md:px-7">
        <Button
          type="button"
          variant="ghost"
          className="cursor-pointer"
          onClick={() => onContinue([])}
        >
          {translate('enterManually')}
        </Button>
        <Button type="button" variant="ghost" className="ml-auto cursor-pointer" onClick={onCancel}>
          {translate('cancel')}
        </Button>
        <Button
          type="button"
          disabled={files.length === 0}
          className="cursor-pointer"
          onClick={next}
        >
          {each ? translate('importEachFile', { count: files.length }) : translate('continue')}
        </Button>
      </div>
    </div>
  )
}

/** The sheet while the AI reads the receipt: placeholders where the form will be, and a way out to typing. */
export function ExpenseReading({ files, onStop }: { files: File[]; onStop: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-0.5 border-b px-5 py-4 md:px-8">
        <h2 className="text-lg font-semibold">{translate('newExpense')}</h2>
        <p className="text-body-sm text-muted-foreground">
          {translate('readingFiles', { count: files.length })}
        </p>
      </div>
      <div className="grid min-h-0 flex-1 content-center justify-items-center gap-2 px-5 py-10 text-center md:px-8">
        <HeidiSparkle animated className="size-6" />
        <p className="text-body font-medium">{translate('readingTheReceipt')}</p>
        <Loader label={translate('readingTheReceipt')} className="min-h-12" />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3 md:px-7">
        <Button type="button" variant="outline" className="ml-auto cursor-pointer" onClick={onStop}>
          {translate('stopAndEnterManually')}
        </Button>
      </div>
    </div>
  )
}
