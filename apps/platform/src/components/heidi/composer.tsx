'use client'
import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import {
  ArrowUp,
  CornerDownRight,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Square,
  X,
} from 'lucide-react'
import { useRef, type Ref } from 'react'

import { MAX_MESSAGE } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { IMPORT_ACCEPT, MAX_IMPORT_FILES } from '@/lib/imports'

import { withQuote } from './quote'

/** The counter appears when a message gets close to the limit. */
export const COUNTER_FROM = 3600

export function Composer({
  value,
  onChange,
  files,
  onAddFiles,
  onRemoveFile,
  onSend,
  onStop,
  busy,
  placeholder,
  textareaRef,
  quote,
  onClearQuote,
}: {
  value: string
  onChange: (value: string) => void
  files: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (file: File) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  placeholder: string
  textareaRef?: Ref<HTMLTextAreaElement>
  /** Part of an answer this message replies to; sent ahead of it. */
  quote?: string | null
  onClearQuote?: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const length = quote ? withQuote(quote, value).length : value.length
  const tooLong = length > MAX_MESSAGE
  const canSend = value.trim().length > 0 && !tooLong && !busy

  return (
    <form
      className="rounded-2xl bg-card shadow-elevation-2 transition-shadow duration-150 focus-within:shadow-[var(--elevation-2),0_0_0_3px_color-mix(in_oklch,var(--heidi),transparent_82%)]"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSend()
      }}
    >
      {(quote || files.length > 0) && (
        // Padding, not margin: a margin on the first child collapses through the form's top edge.
        <div className="grid gap-2 px-2 pt-2">
          {quote && (
            <div className="flex items-start gap-2 rounded-xl bg-heidi-soft py-2 pr-1.5 pl-3 text-body-sm">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-1 font-medium text-heidi-ink">
                  <CornerDownRight className="size-3.5" aria-hidden />
                  {translate('replyingTo')}
                </span>
                <q className="line-clamp-3 whitespace-pre-line text-foreground before:content-none after:content-none">
                  {quote}
                </q>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('removeQuote')}
                className="text-muted-foreground"
                onClick={onClearQuote}
              >
                <X />
              </Button>
            </div>
          )}
          {files.length > 0 && (
            <ul aria-label={translate('attachedFiles')} className="flex flex-wrap gap-1.5">
              {files.map((file) => (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="flex h-7 max-w-52 items-center gap-1.5 rounded-lg bg-muted pr-1 pl-2 text-[12.5px]"
                >
                  {file.type.startsWith('image/') ? (
                    <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={translate('remove2', { name: file.name })}
                    onClick={() => onRemoveFile(file)}
                    className="flex size-5 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label htmlFor="heidi-composer" className="sr-only">
        {translate('messageHeidi')}
      </label>
      <textarea
        id="heidi-composer"
        ref={textareaRef}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-invalid={tooLong || undefined}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const pasted = [...event.clipboardData.files]
          if (pasted.length) {
            event.preventDefault()
            onAddFiles(pasted)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && quote && !value) onClearQuote?.()
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (canSend) onSend()
          }
        }}
        className="block field-sizing-content max-h-56 min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed outline-none placeholder:text-placeholder @sm/heidi:text-[15px]"
      />
      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <input
          ref={picker}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            onAddFiles([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={translate('attachFiles')}
          disabled={files.length >= MAX_IMPORT_FILES}
          className="text-muted-foreground"
          onClick={() => picker.current?.click()}
        >
          <Paperclip className="stroke-[1.5]" />
        </Button>
        {length >= COUNTER_FROM && (
          <span
            aria-live="polite"
            className={cn(
              'ml-auto text-[12px] tabular-nums',
              tooLong ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {length} / {MAX_MESSAGE}
          </span>
        )}
        {busy ? (
          <Button
            type="button"
            size="icon-sm"
            aria-label={translate('stop')}
            className={cn('rounded-full', length < COUNTER_FROM && 'ml-auto')}
            onClick={onStop}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            aria-label={translate('send')}
            disabled={!canSend}
            className={cn('rounded-full', length < COUNTER_FROM && 'ml-auto')}
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  )
}
