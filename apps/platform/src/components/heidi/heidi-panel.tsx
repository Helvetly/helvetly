'use client'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { HeidiSparkle } from '@helvetly/ui/components/heidi-mark'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { useIsMobile } from '@helvetly/ui/hooks/use-mobile'
import { cn } from '@helvetly/ui/lib/utils'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  History,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Search,
  SquarePen,
  Upload,
  X,
} from 'lucide-react'
import { Suspense, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { heidiApi } from '@/lib/heidi'
import { translate } from '@/lib/i18n'

import { ChatHistory } from './chat-history'
import { Composer } from './composer'
import { EmptyState } from './empty-state'
import { MIN_WIDTH, useHeidi } from './heidi-provider'
import { Message } from './message'
import { withQuote } from './quote'
import { SelectionMenu } from './selection-menu'
import { shouldWarn, tokenShare, TokenWarning } from './token-warning'
import { usageKey } from './use-heidi'

function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground [&_svg]:stroke-[1.5]"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Clamps the panel between its minimum and half the window. */
const clampWidth = (width: number) =>
  Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth * 0.5)))

/**
 * Heidi's panel: docked on the right, Max mode over everything, a sheet on phones. Below 1024px
 * (the icon rail) it covers the whole content area: docked beside it, neither would have room.
 */
export function HeidiPanel() {
  const heidi = useHeidi()
  const mobile = useIsMobile()
  if (!heidi) return null
  const body = <PanelBody />

  if (mobile)
    return (
      <Sheet open={heidi.open} onOpenChange={heidi.setOpen}>
        <SheetContent
          data-heidi-panel=""
          side="right"
          className="w-full! max-w-none! gap-0 p-0 [&>button]:hidden"
        >
          <SheetTitle className="sr-only">{translate('heidi')}</SheetTitle>
          <SheetDescription className="sr-only">{translate('yourAssistant')}</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    )

  return (
    <aside
      data-heidi-panel=""
      aria-label={translate('heidi')}
      inert={!heidi.open}
      // Closed, a negative margin pulls the panel out of the row so the page widens as it slides.
      style={
        heidi.max
          ? undefined
          : { width: heidi.width, marginRight: heidi.open ? undefined : -heidi.width }
      }
      className={cn(
        'shrink-0 bg-card transition-[margin,translate,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        !heidi.open && 'pointer-events-none translate-x-[calc(100%+0.5rem)] opacity-0',
        heidi.max
          ? 'fixed inset-0 z-40'
          : 'relative my-2 mr-2 max-w-[50vw] min-w-[320px] rounded-[14px] shadow-elevation-1 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:left-[calc(var(--sidebar-width-icon)+--spacing(4))] max-lg:z-30 max-lg:w-auto! max-lg:max-w-none',
      )}
    >
      {!heidi.max && <ResizeHandle />}
      {body}
    </aside>
  )
}

/**
 * The panel's left edge. A range input underneath, so it is keyboard-accessible as is: arrows
 * resize (towards the content widens), Home/End go to the limits, and it can be dragged.
 */
function ResizeHandle() {
  const heidi = useHeidi()
  if (!heidi) return null
  const { width, setWidth } = heidi
  const max = Math.round(window.innerWidth * 0.5)
  const follow = (event: PointerEvent) =>
    setWidth(clampWidth(window.innerWidth - event.clientX - 8))
  const release = () => {
    window.removeEventListener('pointermove', follow)
    window.removeEventListener('pointerup', release)
  }

  return (
    // Centred in the 8 px gap between the page and the panel, not on the panel's edge.
    <div className="group absolute inset-y-3 -left-2.5 z-10 w-3 max-lg:hidden">
      <input
        type="range"
        aria-label={translate('resizeHeidi')}
        aria-valuetext={translate('pixelsWide', { width: width })}
        // Negative so that the right arrow, like dragging right, makes the panel narrower.
        min={-max}
        max={-MIN_WIDTH}
        step={16}
        value={-width}
        onChange={(event) => setWidth(clampWidth(-Number(event.target.value)))}
        onPointerDown={(event) => {
          event.preventDefault()
          window.addEventListener('pointermove', follow)
          window.addEventListener('pointerup', release)
        }}
        className="peer absolute inset-0 h-full w-full cursor-col-resize appearance-none opacity-0"
      />
      {/* A slim pill in Heidi's colour, shown on hover or keyboard focus: the place to drag. */}
      <span className="pointer-events-none absolute top-1/2 left-1/2 h-9 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-heidi/70 opacity-0 transition-[opacity,height,background-color] duration-150 group-hover:opacity-100 group-active:h-14 group-active:bg-heidi peer-focus-visible:h-14 peer-focus-visible:bg-heidi peer-focus-visible:opacity-100" />
    </div>
  )
}

function PanelBody() {
  const heidi = useHeidi()
  const [searching, setSearching] = useState(false)
  const [history, setHistory] = useState(false)
  const [term, setTerm] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [pinned, setPinned] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [quote, setQuote] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const share = tokenShare(useQuery({ queryKey: usageKey, queryFn: heidiApi.usage }).data)
  const warn = shouldWarn(share)

  const open = heidi?.open ?? false
  const messages = heidi?.chat.messages ?? []

  // Focus the composer whenever the panel opens.
  useEffect(() => {
    // preventScroll: the panel is still off-screen mid-slide, and scrolling to it would skip the slide.
    if (open) requestAnimationFrame(() => composer.current?.focus({ preventScroll: true }))
  }, [open])

  // Stay at the bottom while answers grow, unless the reader scrolled up.
  useEffect(() => {
    const element = scroller.current
    const content = element?.firstElementChild
    if (!pinned || !element || !content || typeof ResizeObserver === 'undefined') return
    const stick = () => {
      element.scrollTop = element.scrollHeight
    }
    stick()
    const observer = new ResizeObserver(stick)
    observer.observe(content)
    return () => observer.disconnect()
  }, [pinned])

  // ⌘F searches the conversation, and files dropped anywhere on the panel are attached.
  const root = useRef<HTMLDivElement>(null)
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key?.toLowerCase() !== 'f' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    setSearching(true)
    requestAnimationFrame(() => searchInput.current?.focus())
  })
  const onDrop = useEffectEvent((event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    heidi?.addFiles([...(event.dataTransfer?.files ?? [])])
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget)))
        setDragging(false)
    }
    element.addEventListener('keydown', onKey)
    element.addEventListener('dragover', over)
    element.addEventListener('dragleave', leave)
    element.addEventListener('drop', onDrop)
    return () => {
      element.removeEventListener('keydown', onKey)
      element.removeEventListener('dragover', over)
      element.removeEventListener('dragleave', leave)
      element.removeEventListener('drop', onDrop)
    }
  }, [])

  const needle = term.trim().toLowerCase()
  const matches =
    !history && needle.length >= 2
      ? messages.filter((message) => message.text.toLowerCase().includes(needle)).map((m) => m.id)
      : []
  const current = matches[Math.min(matchIndex, matches.length - 1)]

  useEffect(() => {
    if (!current) return
    scroller.current
      ?.querySelector(`[data-message="${current}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [current])

  if (!heidi) return null
  const { chat } = heidi

  // The one way a quote reaches the composer: the selection toolbar and the right-click menu.
  const quoteInReply = (text: string) => {
    setQuote(text)
    composer.current?.focus()
  }

  const send = async () => {
    // Not now in the AI approval keeps the draft, the quote and the files.
    if (!(await chat.send(quote ? withQuote(quote, heidi.draft) : heidi.draft, heidi.files))) return
    setHistory(false)
    setQuote(null)
    heidi.setDraft('')
    heidi.clearFiles()
    setPinned(true)
  }

  const closeSearch = () => {
    setSearching(false)
    setTerm('')
    composer.current?.focus()
  }

  return (
    <div ref={root} className="@container/heidi relative flex h-full min-h-0 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-border/60 px-3">
        <HeidiSparkle className="mr-1.5 size-5" />
        <div className="mr-auto flex min-w-0 items-baseline gap-2">
          <h2 className="text-[15px] font-medium">{translate('heidi')}</h2>
          <span className="truncate text-[13px] text-muted-foreground">
            {translate('yourAIAssistant')}
          </span>
        </div>
        <IconButton
          label={translate('chats')}
          pressed={history}
          onClick={() => {
            setHistory(!history)
            setTerm('')
            setMatchIndex(0)
          }}
        >
          <History />
        </IconButton>
        <IconButton
          label={history ? translate('searchChats') : translate('searchInConversation')}
          pressed={searching}
          onClick={() => {
            if (searching) return closeSearch()
            setSearching(true)
            requestAnimationFrame(() => searchInput.current?.focus())
          }}
        >
          <Search />
        </IconButton>
        <IconButton
          label={translate('newChat')}
          onClick={() => {
            setQuote(null)
            setHistory(false)
            chat.newChat()
          }}
        >
          <SquarePen />
        </IconButton>
        <IconButton
          label={heidi.max ? translate('classicView') : translate('maxView')}
          onClick={() => heidi.setMax(!heidi.max)}
        >
          {heidi.max ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton label={translate('collapse')} onClick={() => heidi.setOpen(false)}>
          <PanelRightClose />
        </IconButton>
      </header>

      {searching && (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchInput}
            type="search"
            aria-label={history ? translate('searchChats') : translate('searchInConversation')}
            placeholder={history ? translate('searchChats') : translate('searchInConversation')}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setMatchIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch()
              if (event.key === 'Enter' && matches.length)
                setMatchIndex(
                  (index) => (index + (event.shiftKey ? -1 : 1) + matches.length) % matches.length,
                )
            }}
            // The bar has its own close button; the browser's clear button would be a second ×.
            className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[14px] outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:appearance-none"
          />
          {!history && (
            <>
              <span
                aria-live="polite"
                className="text-[12px] whitespace-nowrap text-muted-foreground tabular-nums"
              >
                {needle.length >= 2
                  ? matches.length
                    ? translate('dynamicOf3', { value1: matchIndex + 1, length: matches.length })
                    : translate('noMatches')
                  : ''}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={translate('previousMatch')}
                disabled={!matches.length}
                onClick={() =>
                  setMatchIndex((index) => (index - 1 + matches.length) % matches.length)
                }
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={translate('nextMatch')}
                disabled={!matches.length}
                onClick={() => setMatchIndex((index) => (index + 1) % matches.length)}
              >
                <ChevronDown />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('closeSearch')}
            onClick={closeSearch}
          >
            <X />
          </Button>
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget
          setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 64)
        }}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          className={cn(
            // A wide panel keeps a readable column in the middle, as the composer below does.
            'mx-auto flex min-h-full w-full flex-col px-4',
            heidi.max ? 'max-w-3xl px-6' : 'max-w-176',
          )}
        >
          {history ? (
            <ChatHistory
              current={chat.conversationId}
              term={searching ? term : ''}
              onOpen={(id) => {
                chat.open(id)
                setHistory(false)
                // The chats' filter has done its job; the conversation opens without a search bar.
                setSearching(false)
                setTerm('')
                setQuote(null)
                setPinned(true)
              }}
            />
          ) : messages.length === 0 ? (
            chat.restoring ? (
              <p className="m-auto text-[13px] text-muted-foreground">
                {translate('pickingUpWhereYouLeftOff')}
              </p>
            ) : (
              // The welcome reads the open record from the URL, which needs a boundary in a static export.
              <Suspense>
                <EmptyState
                  page={heidi.page}
                  wide={heidi.max}
                  onPick={(prompt) => chat.send(prompt)}
                />
              </Suspense>
            )
          ) : (
            <div role="log" aria-live="polite" aria-label={translate('conversation')}>
              <ol className="grid grid-cols-[minmax(0,1fr)] gap-6 py-6">
                {messages.map((message, index) => {
                  const next = messages[index + 1]
                  return (
                    <Message
                      key={message.id}
                      message={message}
                      answer={message.form && next?.role === 'user' ? next.text : undefined}
                      busy={chat.busy}
                      highlighted={message.id === current}
                      onRetry={() => chat.retry(message.id)}
                      onSubmitForm={(text, files) => chat.send(text, files)}
                      onQuote={quoteInReply}
                      turnFiles={messages[index - 1]?.files}
                    />
                  )
                })}
              </ol>
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          'relative mx-auto w-full shrink-0 px-3 pb-3',
          heidi.max ? 'max-w-3xl px-6 pb-5' : 'max-w-176',
        )}
      >
        {!pinned && !history && messages.length > 0 && (
          <button
            type="button"
            onClick={() => setPinned(true)}
            className="absolute -top-11 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-card px-3 text-[12.5px] shadow-elevation-2 transition-colors duration-150 hover:bg-muted"
          >
            <ArrowDown className="size-3.5" />
            {translate('jumpToLatest')}
          </button>
        )}
        {warn && <TokenWarning share={share} />}
        <Composer
          attached={warn}
          textareaRef={composer}
          value={heidi.draft}
          onChange={heidi.setDraft}
          files={heidi.files}
          onAddFiles={heidi.addFiles}
          onRemoveFile={heidi.removeFile}
          onSend={send}
          onStop={chat.stop}
          busy={chat.busy}
          placeholder={translate('askHeidiAboutYourInvoicesClientsExpenses')}
          quote={quote}
          onClearQuote={() => {
            setQuote(null)
            composer.current?.focus()
          }}
        />
      </div>

      <SelectionMenu root={root} scroller={scroller} onQuote={quoteInReply} />

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-heidi/45 bg-heidi-soft/60 text-[14px] text-heidi-ink backdrop-blur-sm">
          <Upload className="size-5" />
          {translate('dropFilesToAttach')}
        </div>
      )}

      {heidi.open && chat.confirmation && (
        <ConfirmDialog
          key={chat.confirmation.id}
          title={chat.confirmation.title}
          body={chat.confirmation.body}
          confirmLabel={chat.confirmation.confirm_label}
          tone={chat.confirmation.tone}
          onDecide={(approved) => void chat.decide(approved)}
        />
      )}
    </div>
  )
}
