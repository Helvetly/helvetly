'use client'

import { Loader } from '@helvetly/ui/components/loader'
import { cn } from '@helvetly/ui/lib/utils'
import Image from 'next/image'
import type * as PdfJsModule from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'

import { contentUrl, type DocFile } from '@/lib/documents'

import { extensionOf, KIND_STYLE } from './kind'

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

// First pages already drawn this session, by file id and checksum (a replaced file draws again).
type Page = { url: string; ratio: number }
const drawn = new Map<string, Promise<Page | null>>()
// Thumbnails are drawn two at a time, so a folder of PDFs does not stall the page.
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

const THUMB_WIDTH = 360

function firstPage(file: DocFile) {
  const key = `${file.id}:${file.sha256 ?? file.updated_at}`
  let image = drawn.get(key)
  if (!image) {
    image = slot(async () => {
      const res = await fetch(contentUrl(file.id), { credentials: 'same-origin' })
      if (!res.ok) return null
      const task = (await pdfjs()).getDocument({ data: new Uint8Array(await res.arrayBuffer()) })
      const doc = await task.promise
      try {
        const page = await doc.getPage(1)
        const viewport = page.getViewport({
          scale: THUMB_WIDTH / page.getViewport({ scale: 1 }).width,
        })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await page.render({ canvas, viewport }).promise
        return {
          url: canvas.toDataURL('image/webp', 0.85),
          ratio: viewport.height / viewport.width,
        }
      } finally {
        void task.destroy().catch(() => undefined)
      }
    }).catch(() => null)
    drawn.set(key, image)
  }
  return image
}

/** Becomes true once the element scrolls near the viewport. */
function useNear<T extends Element>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || near) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), {
      rootMargin: '300px',
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [near])
  return [ref, near] as const
}

/**
 * A file's face in the grid: the image itself, the first page of a PDF, or a tinted sheet with
 * the extension for everything else.
 */
export function Thumbnail({ file, className }: { file: DocFile; className?: string }) {
  const [ref, near] = useNear<HTMLDivElement>()
  const [pdf, setPdf] = useState<Page | null>(null)
  const [failed, setFailed] = useState(false)
  const isPdf = file.kind === 'pdf'
  const isImage = file.kind === 'image'

  useEffect(() => {
    if (!near || !isPdf) return
    let live = true
    void firstPage(file).then((url) => {
      if (!live) return
      if (url) setPdf(url)
      else setFailed(true)
    })
    return () => {
      live = false
    }
  }, [near, isPdf, file])

  const { icon: Icon, tint } = KIND_STYLE[file.kind]
  const fallback = (
    <div className="flex size-full items-center justify-center">
      <div
        className={cn(
          'relative flex aspect-[3/4] h-[72%] flex-col items-center justify-center gap-2 rounded-[6px] shadow-elevation-1',
          tint,
        )}
      >
        <Icon className="size-6 stroke-[1.5]" />
        <span className="text-[11px] font-semibold tracking-[0.06em]">
          {extensionOf(file.name, file.kind)}
        </span>
      </div>
    </div>
  )

  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)}>
      {isImage && near && !failed ? (
        <Image
          src={contentUrl(file.id)}
          alt=""
          fill
          unoptimized
          sizes="240px"
          draggable={false}
          onError={() => setFailed(true)}
          className="object-cover"
        />
      ) : isPdf && pdf ? (
        <div className="flex size-full items-start justify-center px-[14%] pt-[9%]">
          <span
            className="relative w-full overflow-hidden rounded-t-[3px] bg-white shadow-elevation-2"
            style={{ aspectRatio: `1 / ${pdf.ratio}` }}
          >
            <Image src={pdf.url} alt="" fill unoptimized sizes="240px" draggable={false} />
          </span>
        </div>
      ) : isPdf && !failed ? (
        <div className="flex size-full items-start justify-center px-[14%] pt-[9%]">
          <div className="grid aspect-[1/1.414] w-full place-items-center rounded-t-[3px] bg-white/80 shadow-elevation-1 dark:bg-white/10">
            <Loader className="min-h-0" />
          </div>
        </div>
      ) : (
        fallback
      )}
    </div>
  )
}
