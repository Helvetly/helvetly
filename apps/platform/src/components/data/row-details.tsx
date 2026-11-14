'use client'

import { Button } from '@helvetly/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Ellipsis, Maximize2, Paperclip, Sparkle, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Initials } from '@/components/initials'

/** What clicking a row's name (or tapping the row on a phone) shows about it. */
export type RowDetails = {
  name: string
  fields: { icon: LucideIcon; label: string; value: ReactNode }[]
  /** The button under the fields, e.g. "Contact" or "Remind". */
  action: string
  /** Heidi's one-tap drafts under the composer: chip label and the text it writes. */
  drafts: { label: string; text: string }[]
}

function DetailsCard({ details, onAction }: { details: RowDetails; onAction: () => void }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2.5">
        <Initials name={details.name} className="size-8 text-[11px]" />
        <span className="truncate text-[15px]">{details.name}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
        {details.fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="contents">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4 stroke-[1.5]" />
              {label}
            </dt>
            <dd className="min-w-0 truncate">{value}</dd>
          </div>
        ))}
      </dl>
      <Button className="w-fit" onClick={onAction}>
        {details.action}
      </Button>
    </div>
  )
}

/** A compact message box with Heidi's drafts underneath. Sending is not wired yet. */
export function Composer({
  to,
  drafts,
  onClose,
}: {
  to: string
  drafts: RowDetails['drafts']
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  // The message box takes focus when it opens from the card's button.
  useEffect(() => field.current?.focus(), [])
  const send = () => {
    // shortcut: no messaging backend yet; send through the API once it exists.
    toast(`Messages to ${to} are coming soon.`)
    onClose()
  }

  return (
    <div className="grid w-full overflow-hidden rounded-2xl bg-card shadow-[0_12px_40px_-8px_rgb(0_0_0/0.16),0_4px_12px_rgb(0_0_0/0.05)] ring-1 ring-black/[0.03] dark:ring-foreground/10">
      <div className="relative">
        <label htmlFor="composer" className="sr-only">
          Message to {to}
        </label>
        <textarea
          id="composer"
          ref={field}
          rows={3}
          placeholder="Write a message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onClose()}
          className="block w-full resize-none bg-transparent px-4 pt-3.5 pr-10 text-[15px] outline-none placeholder:text-placeholder"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close"
          className="absolute top-2.5 right-2.5 text-muted-foreground"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-0.5 px-2.5 pb-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Attach a file"
          className="text-muted-foreground"
          onClick={() => toast('Attachments are coming soon.')}
        >
          <Paperclip className="stroke-[1.5]" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Let Heidi write it"
          className="text-muted-foreground"
          onClick={() => setText(drafts[0]?.text ?? '')}
        >
          <Sparkle className="stroke-[1.5]" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open full editor"
          className="text-muted-foreground"
          onClick={() => toast('The full editor is coming soon.')}
        >
          <Maximize2 className="stroke-[1.5]" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More"
          className="text-muted-foreground"
          onClick={() => toast('More options are coming soon.')}
        >
          <Ellipsis />
        </Button>
        <Button className="ml-auto" disabled={!text.trim()} onClick={send}>
          Send
        </Button>
      </div>
      {/* Heidi's drafts only help before anything is written, so they step aside once it is. */}
      {!text && drafts.length > 0 && (
        <div className="grid gap-0.5 border-t px-1.5 py-1.5">
          <p className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[12px] text-muted-foreground">
            <Sparkle className="size-3.5 stroke-[1.5] text-[#9b5aa0]" /> Draft with Heidi
          </p>
          {drafts.map((draft) => (
            <button
              key={draft.label}
              type="button"
              onClick={() => {
                setText(draft.text)
                field.current?.focus()
              }}
              className="grid gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="text-[14px] text-foreground">{draft.label}</span>
              <span className="truncate text-[12px] text-muted-foreground">{draft.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Desktop: clicking the name opens its card (one at a time); its button opens the composer below it. */
export function DetailsPopover({
  details,
  onAction,
  children,
}: {
  details: RowDetails
  /** Replaces the composer: the card's button does this instead (e.g. open the record). */
  onAction?: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const close = () => {
    setComposing(false)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setComposing(false)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={details.name}
        align="start"
        sideOffset={6}
        className="relative w-[340px] gap-0 p-4"
      >
        <DetailsCard
          details={details}
          onAction={() => {
            if (!onAction) return setComposing(true)
            setOpen(false)
            onAction()
          }}
        />
        {composing && (
          <div className="absolute top-[calc(100%-44px)] left-24 z-10 w-[360px] animate-in duration-150 fade-in slide-in-from-top-1">
            <Composer to={details.name} drafts={details.drafts} onClose={close} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Phones: tapping a row opens the same details as a bottom sheet. */
export function DetailsSheet({
  details,
  onClose,
}: {
  details: RowDetails | null
  onClose: () => void
}) {
  const [composing, setComposing] = useState(false)

  return (
    <Sheet
      open={details !== null}
      onOpenChange={(open) => {
        if (!open) {
          setComposing(false)
          onClose()
        }
      }}
    >
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="sr-only">{details?.name}</SheetTitle>
        <SheetDescription className="sr-only">Details</SheetDescription>
        {details &&
          (composing ? (
            <Composer
              to={details.name}
              drafts={details.drafts}
              onClose={() => setComposing(false)}
            />
          ) : (
            <DetailsCard details={details} onAction={() => setComposing(true)} />
          ))}
      </SheetContent>
    </Sheet>
  )
}
