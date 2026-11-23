'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { cn } from '@helvetly/ui/lib/utils'
import { Download, FileWarning, RotateCw } from 'lucide-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type * as PdfJsModule from 'pdfjs-dist'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'

type PdfJs = typeof PdfJsModule
let library: Promise<PdfJs> | null = null

/** pdf.js on first use, with its worker as a bundled module (works in the static export). */
function pdfjs() {
  library ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' },
    )
    return lib
  })
  return library
}

type Problem = { title: string; text: string; retry: boolean }
type State = { doc: PDFDocumentProxy } | { problem: Problem } | null

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

/** What went wrong, in words for the person: pdf.js names its errors, the server answers a status. */
export function pdfProblem(error: unknown): Problem {
  if (error instanceof HttpError)
    return error.status === 404 || error.status === 410
      ? {
          title: translate('thisFileIsNoLongerHere'),
          text: translate('itWasMovedToTheTrashOrDeletedChoose'),
          retry: false,
        }
      : {
          title: translate('thePreviewCouldnTLoad'),
          text: translate('theServerAnsweredTryAgainInAMoment', { status: error.status }),
          retry: true,
        }
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException')
    return {
      title: translate('thisPDFIsPasswordProtected'),
      text: translate('removeThePasswordPrintItToANewPDF'),
      retry: false,
    }
  if (name === 'InvalidPDFException' || name === 'FormatError')
    return {
      title: translate('thisFileCanTBeOpenedAsAPDF'),
      text: translate('itIsDamagedOrItIsnTReallyA'),
      retry: false,
    }
  return {
    title: translate('thePreviewCouldnTLoad'),
    text: translate('checkYourConnectionAndTryAgain'),
    retry: true,
  }
}

/**
 * A PDF drawn page by page onto canvases: white sheets on a quiet background, fit to the width,
 * sharp on retina screens, each page rendered once it scrolls near. The session cookie goes along
 * with the fetch, so it shows drafts (live) and issued documents alike.
 */
export function PdfView({
  src,
  title,
  className,
  onPages,
  overlay,
  zoom = 1,
}: {
  src: string
  title: string
  className?: string
  /** 1 fits the pane; above it the pages grow past it and the pane scrolls both ways. */
  zoom?: number
  /** Told the page count once the document is open. */
  onPages?: (count: number) => void
  /** Drawn over each page (1-based), in a box the page's size: position children in percentages. */
  overlay?: (page: number) => ReactNode
}) {
  const [state, setState] = useState<State>(null)
  const [attempt, setAttempt] = useState(0)
  const [width, setWidth] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  // A notification, not an input: a new onPages must not reload the document.
  const announce = useEffectEvent((count: number) => onPages?.(count))

  useEffect(() => {
    const controller = new AbortController()
    const opened: PDFDocumentLoadingTask[] = []
    // A retry skips the browser cache, which may hold the failed answer.
    fetch(src, {
      credentials: 'same-origin',
      signal: controller.signal,
      cache: attempt > 0 ? 'reload' : 'default',
    })
      .then(async (res) => {
        if (!res.ok) throw new HttpError(res.status)
        const data = new Uint8Array(await res.arrayBuffer())
        const task = (await pdfjs()).getDocument({ data })
        opened.push(task)
        const doc = await task.promise
        if (controller.signal.aborted) return
        setState({ doc })
        announce(doc.numPages)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ problem: pdfProblem(error) })
        announce(0)
      })
    return () => {
      controller.abort()
      for (const task of opened) void task.destroy().catch(() => undefined)
    }
  }, [src, attempt])

  // Pages follow the frame's width (the sheet resizes with the window).
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      role="document"
      aria-label={title}
      aria-busy={!state}
      // Its own scroller: reachable by keyboard, and the wheel never carries over to the drawer around it.
      tabIndex={0}
      className={cn(
        'overflow-auto overscroll-contain bg-panel outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:bg-background',
        className,
      )}
    >
      <div
        ref={frame}
        style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: 'none' }}
        className={cn(
          'mx-auto grid min-h-full w-full max-w-[860px] gap-6 px-6 py-8',
          // A problem sits in the middle of the pane; pages start at the top.
          state && 'problem' in state ? 'content-center' : 'content-start',
        )}
      >
        {state && 'problem' in state ? (
          <ProblemCard
            problem={state.problem}
            src={src}
            onRetry={() => {
              setState(null)
              setAttempt(attempt + 1)
            }}
          />
        ) : state && width > 0 ? (
          Array.from({ length: state.doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={state.doc} number={i + 1} width={width - 48} overlay={overlay} />
          ))
        ) : (
          <Sheet />
        )}
      </div>
    </section>
  )
}

/** The problem card's page sketch: a heading, a gap, then a paragraph; widths in percent. */
const SKETCH_LINES = [
  { id: 'heading', width: 70 },
  { id: 'subheading', width: 45 },
  { id: 'gap', width: 0 },
  { id: 'paragraph-start', width: 90 },
  { id: 'paragraph-middle', width: 90 },
  { id: 'paragraph-end', width: 60 },
]

/** A torn sheet with what went wrong and what to do about it, where the pages would be. */
function ProblemCard({
  problem,
  src,
  onRetry,
}: {
  problem: Problem
  src: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="grid justify-items-center gap-5 pb-[8vh] text-center">
      <div className="relative">
        <div className="flex aspect-[1/1.414] w-32 flex-col gap-2 rounded-[3px] bg-white p-4 shadow-elevation-2 dark:bg-white/[0.06]">
          {SKETCH_LINES.map((line) => (
            <span
              key={line.id}
              className="h-1.5 rounded-full bg-black/[0.07] dark:bg-white/10"
              style={{ width: `${line.width}%`, opacity: line.width ? 1 : 0 }}
            />
          ))}
        </div>
        <span className="absolute -right-3 -bottom-3 flex size-10 items-center justify-center rounded-full bg-[#fbe9e7] text-[#c2413f] shadow-elevation-1 ring-4 ring-panel dark:bg-red-500/15 dark:text-red-300 dark:ring-background">
          <FileWarning className="size-5 stroke-[1.75]" />
        </span>
      </div>
      <div className="grid max-w-[44ch] gap-1.5">
        <p className="text-[15px] font-medium text-foreground">{problem.title}</p>
        <p className="text-[13.5px] text-pretty text-muted-foreground">{problem.text}</p>
      </div>
      <div className="flex gap-2">
        {problem.retry && (
          <Button className="cursor-pointer gap-1.5" onClick={onRetry}>
            <RotateCw className="size-4" />
            {translate('tryAgain2')}
          </Button>
        )}
        <Button asChild variant="outline" className="gap-1.5">
          <a href={localizedHref(src)} download>
            <Download className="size-4" />
            {translate('downloadFile')}
          </a>
        </Button>
      </div>
    </div>
  )
}

/** A blank A4 sheet with the loader, while a page loads or renders. */
function Sheet({ ratio = Math.SQRT2 }: { ratio?: number }) {
  return (
    <div
      className="grid place-items-center rounded-[3px] bg-white shadow-elevation-2"
      style={{ aspectRatio: `1 / ${ratio}` }}
    >
      <Loader />
    </div>
  )
}

function PdfPage({
  doc,
  number,
  width,
  overlay,
}: {
  doc: PDFDocumentProxy
  number: number
  width: number
  overlay?: (page: number) => ReactNode
}) {
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [near, setNear] = useState(number === 1)
  const [drawn, setDrawn] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    // The document is destroyed when the view closes; a page still loading then rejects, which is expected.
    void doc.getPage(number).then(
      (loaded) => live && setPage(loaded),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [doc, number])

  // Render a page only once it comes near the visible part of the scroller.
  useEffect(() => {
    const element = box.current
    if (!element || near) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), {
      rootMargin: '600px 0px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])

  useEffect(() => {
    const target = canvas.current
    if (!page || !near || !target || width <= 0) return
    const scale = width / page.getViewport({ scale: 1 }).width
    const ratio = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * ratio })
    target.width = Math.floor(viewport.width)
    target.height = Math.floor(viewport.height)
    const task = page.render({ canvas: target, viewport })
    task.promise.then(
      () => setDrawn(true),
      () => {}, // cancelled by a newer size
    )
    return () => task.cancel()
  }, [page, near, width])

  const size = page?.getViewport({ scale: 1 })
  const ratio = size ? size.height / size.width : Math.SQRT2
  return (
    <div ref={box} className="relative" style={{ aspectRatio: `1 / ${ratio}` }}>
      {!drawn && (
        <div className="absolute inset-0">
          <Sheet ratio={ratio} />
        </div>
      )}
      <canvas
        ref={canvas}
        aria-label={translate('page2', { number: number })}
        data-pdf-page={number}
        className={cn(
          'block size-full rounded-[3px] bg-white shadow-elevation-2 transition-opacity duration-300',
          drawn ? 'opacity-100' : 'opacity-0',
        )}
      />
      {overlay && page && (
        // The page's width in points, so an overlay can print text at a size in points.
        <div className="absolute inset-0" data-page-points={size?.width}>
          {overlay(number)}
        </div>
      )}
    </div>
  )
}
