'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Slider } from '@helvetly/ui/components/slider'
import type { CropArea } from '@helvetly/ui/lib/photo'
import { cn } from '@helvetly/ui/lib/utils'
import { LoaderCircle, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Cropper from 'react-easy-crop'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { LOGO_MAX_BYTES, logoProblem } from '@/lib/invoices'
import {
  clampView,
  cropWorkspaceLogo,
  DOCUMENT_MAX_ZOOM,
  DOCUMENT_MIN_DPI,
  DOCUMENT_MIN_ZOOM,
  documentDpi,
  imageSize,
  isWholePicture,
  LOGO_MAX_SIDE,
  LOGO_MIN_SIDE,
  normalizeLogo,
  renderDocumentLogo,
  sizeProblem,
  sniffFormat,
  svgSize,
  WHOLE_PICTURE,
  workspaceCropTooSmall,
  type DocumentView,
  type LogoFormat,
} from '@/lib/logo-crop'

import { DocumentLogoFrame } from './document-logo-frame'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
// Shapes this far from the 2.5 : 1 field get a word on how they are placed.
const ODD_RATIO = [1.4, 6] as const
const ZOOM_STEP = 0.1

/** Whether the bytes, not the claimed type, are a PNG: the server and the PDF library go by bytes too. */
async function isPngBytes(file: Blob) {
  const head = new DataView(await file.slice(0, 4).arrayBuffer())
  return head.byteLength === 4 && head.getUint32(0) === 0x89504e47
}

export type LogoKind = 'workspace' | 'document'

/**
 * Why a picked file cannot be cropped into a logo (translated), or what it is: the bytes decide the format, and the
 * pixel size comes from its header (an SVG's from what it declares), before anything is decoded.
 */
async function inspect(
  file: File,
): Promise<{ problem: string } | { format: LogoFormat; size: { width: number; height: number } }> {
  const big = logoProblem(file)
  if (big) return { problem: big }
  const format = await sniffFormat(file)
  if (!format) return { problem: translate('useAPNGOrJPEGImage') }
  if (format === 'svg') {
    const size = svgSize(await file.text())
    return size ? { format, size } : { problem: translate('logoSvgDimensionsInvalid') }
  }
  const size = await imageSize(file)
  if (!size || sizeProblem(size.width, size.height) === 'unreadable')
    return { problem: translate('logoUnreadable') }
  if (sizeProblem(size.width, size.height) === 'too-large')
    return { problem: translate('logoTooManyPixels') }
  return { format, size }
}

/** Why a picked file cannot be a logo (translated), or null. */
export async function pickProblem(file: File) {
  const found = await inspect(file)
  return 'problem' in found ? found.problem : null
}

type Picked = { file: File; url: string; origin: Origin }
/** Where the picture comes from: as picked (PNG, JPEG), a static PNG made from a WebP or GIF, or one drawn from an SVG. */
type Origin = 'file' | 'raster' | 'vector'

/** The file to crop (a WebP, GIF or SVG already turned into a PNG) or why there is none. */
export async function prepareLogo(file: File): Promise<{ problem: string } | Omit<Picked, 'url'>> {
  const found = await inspect(file)
  if ('problem' in found) return found
  try {
    const made = await normalizeLogo(file, found.format, found.size)
    const origin = made.vector ? 'vector' : made.file === file ? 'file' : 'raster'
    return { file: made.file, origin }
  } catch {
    return { problem: translate('logoUnreadable') }
  }
}

/**
 * Picks a logo, checks it, frames it in the dialog and uploads the result with `send`; `pickError` is what is wrong
 * with the file picked (shown by the caller next to its picker), `dialog` is what to render. Nothing is sent until
 * the dialog is confirmed.
 */
export function useLogoCrop({
  kind,
  send,
  progress,
  onSaved,
}: {
  kind: LogoKind
  send: (
    file: File,
    handlers: { onSuccess: () => void; onError: (failure: unknown) => void },
  ) => void
  progress: number | null
  onSaved: () => void
}): { pick: (file: File | undefined) => void; pickError: string; dialog: ReactNode } {
  const [picked, setPicked] = useState<Picked | null>(null)
  // Only the latest pick counts: an earlier file may finish being read after a later one was chosen.
  const latest = useRef(0)
  const [pickError, setPickError] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [saving, setSaving] = useState(false)
  // The object URL is made when a file is picked and freed when the dialog closes or the page goes.
  const current = useRef(picked)
  useEffect(() => {
    current.current = picked
  }, [picked])
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current.url)
    },
    [],
  )

  const pick = (file: File | undefined) => {
    if (!file) return
    const turn = (latest.current += 1)
    void prepareLogo(file).then((prepared) => {
      if (turn !== latest.current) return
      setUploadError('')
      if ('problem' in prepared) setPickError(prepared.problem)
      else {
        setPickError('')
        setPicked({ ...prepared, url: URL.createObjectURL(prepared.file) })
      }
    })
  }
  const close = () => {
    if (picked) URL.revokeObjectURL(picked.url)
    setPicked(null)
    setUploadError('')
  }
  const dialog = picked && (
    <LogoCropDialog
      kind={kind}
      file={picked.file}
      origin={picked.origin}
      url={picked.url}
      saving={saving}
      progress={progress}
      error={uploadError}
      onCancel={close}
      onSave={(logo) => {
        setSaving(true)
        setUploadError('')
        send(new File([logo], picked.file.name, { type: logo.type }), {
          onSuccess: () => {
            setSaving(false)
            close()
            onSaved()
          },
          onError: (failure) => {
            setSaving(false)
            setUploadError(errorMessage(failure))
          },
        })
      }}
    />
  )
  return { pick, pickError, dialog: dialog || null }
}

/**
 * Frames a picked logo before it is saved. The workspace's mark is a square: drag (or arrow keys) and zoom to choose it,
 * saved as a 512 px PNG that keeps its transparency. The document logo is saved in the PDF's wide 2.5 : 1 field: it
 * starts as the whole picture contained in it, zooming in only trims it, and it is never stretched. Cancelling sends nothing; a failed upload keeps
 * the dialog open so saving again retries it.
 */
export function LogoCropDialog({
  kind,
  file,
  origin = 'file',
  url,
  saving,
  progress,
  error,
  onCancel,
  onSave,
}: {
  kind: LogoKind
  file: File
  /** Where the picture comes from; only a `file` as picked may be sent unchanged (default: as picked). */
  origin?: Origin
  /** An object URL of `file`, owned by the caller. */
  url: string
  saving: boolean
  /** The upload's progress (0–1) while it runs. */
  progress: number | null
  error: string
  onCancel: () => void
  onSave: (logo: Blob) => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [area, setArea] = useState<{ percent: CropArea; pixels: CropArea } | null>(null)
  const [view, setView] = useState<DocumentView>(WHOLE_PICTURE)
  const [problem, setProblem] = useState('')
  // The resolution refusal is about the current placement, so moving or zooming clears it; the next save checks again.
  const [lowResolution, setLowResolution] = useState('')
  const [encoding, setEncoding] = useState(false)
  const busy = saving || encoding
  const shown = problem || lowResolution || error
  const isDocument = kind === 'document'
  const ready = isDocument ? !!natural : !!area
  const ratio = natural ? natural.width / natural.height : 1
  const odd = isDocument && natural && (ratio < ODD_RATIO[0] || ratio > ODD_RATIO[1])

  // The document logo starts from the file's header size (so nothing waits), and the picture itself corrects it once it
  // decodes: a JPEG turned by its EXIF orientation is decoded with the sides swapped, which the header does not say.
  // The workspace cropper reports its own size once loaded.
  useEffect(() => {
    if (isDocument) void imageSize(file).then((size) => size && setNatural(size))
  }, [isDocument, file])

  const placeDocument = (next: DocumentView) => {
    setView(next)
    setLowResolution('')
  }
  const zoomTo = (next: number) => {
    setLowResolution('')
    if (isDocument && natural) setView(clampView(natural, { ...view, zoom: next }))
    else setZoom(next)
  }

  const save = async () => {
    if (!ready || !natural || busy) return
    setEncoding(true)
    setProblem('')
    try {
      // New uploads keep the printing floor whatever their format, so an untouched PNG does not bypass it either.
      // An SVG is already a fixed raster by now (2048 px on its long side), so it is held to the same floor.
      if (isDocument && documentDpi(natural, view) < DOCUMENT_MIN_DPI) {
        setLowResolution(translate('logoRasterResolutionTooLow'))
        return
      }
      // A PNG that already has the field's shape, shown whole, is sent as picked: the same bytes, so a duplicate is found.
      // A JPEG never is, whatever its name or type says: its EXIF turn (the PDF library ignores it) is only applied by decoding and re-encoding it.
      if (
        isDocument &&
        origin === 'file' &&
        file.size <= LOGO_MAX_BYTES &&
        file.type === 'image/png' &&
        Math.max(natural.width, natural.height) <= LOGO_MAX_SIDE &&
        Math.min(natural.width, natural.height) >= LOGO_MIN_SIDE &&
        isWholePicture(natural, view) &&
        (await isPngBytes(file))
      ) {
        onSave(file)
        return
      }
      const bitmap = await createImageBitmap(file)
      try {
        if (!isDocument && area && workspaceCropTooSmall(area.pixels)) {
          setLowResolution(translate('logoRasterResolutionTooLow'))
          return
        }
        const logo =
          !isDocument && area
            ? await cropWorkspaceLogo(bitmap, area.pixels)
            : await renderDocumentLogo(bitmap, { width: bitmap.width, height: bitmap.height }, view)
        if (logo) onSave(logo)
        else setProblem(translate('theLogoCanBeAtMost2MB'))
      } finally {
        bitmap.close()
      }
    } catch (failure) {
      setProblem(errorMessage(failure))
    } finally {
      setEncoding(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('adjustLogo')}</DialogTitle>
          <DialogDescription>{translate('dragTheLogoToPlaceItAndZoom')}</DialogDescription>
        </DialogHeader>
        {isDocument ? (
          natural && (
            <DocumentLogoFrame
              url={url}
              natural={natural}
              view={view}
              disabled={busy}
              onChange={placeDocument}
              onDecoded={(size) =>
                setNatural((current) =>
                  current?.width === size.width && current.height === size.height ? current : size,
                )
              }
              onError={() => setProblem(translate('logoUnreadable'))}
            />
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <div className="relative h-72 overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={url}
                crop={crop}
                zoom={zoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                aspect={1}
                showGrid={false}
                objectFit="cover"
                onCropChange={(next) => {
                  setCrop(next)
                  setLowResolution('')
                }}
                onZoomChange={zoomTo}
                onMediaLoaded={(media) =>
                  setNatural({ width: media.naturalWidth, height: media.naturalHeight })
                }
                onCropComplete={(percent, pixels) => setArea({ percent, pixels })}
                mediaProps={{
                  onError: () => setProblem(translate('logoUnreadable')),
                }}
                cropperProps={{
                  role: 'group',
                  'aria-label': translate('cropAreaDragOrUseTheArrowKeysTo'),
                }}
                classes={{ cropAreaClassName: 'focus-visible:ring-3 focus-visible:ring-ring/50' }}
              />
            </div>
            <figure className="flex items-center gap-3 sm:flex-col sm:items-start sm:pt-2">
              <CropPreview url={url} area={area?.percent} className="size-16 rounded-xl" />
              <CropPreview url={url} area={area?.percent} className="size-8 rounded-lg" />
              <figcaption className="text-body-sm text-muted-foreground">
                {translate('preview')}
              </figcaption>
            </figure>
          </div>
        )}
        <div className="flex items-center gap-3">
          <ZoomOut aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Slider
            aria-label={translate('zoom')}
            min={isDocument ? DOCUMENT_MIN_ZOOM : MIN_ZOOM}
            max={isDocument ? DOCUMENT_MAX_ZOOM : MAX_ZOOM}
            step={ZOOM_STEP}
            value={[isDocument ? view.zoom : zoom]}
            onValueChange={([next]) => next !== undefined && zoomTo(next)}
            disabled={busy}
          />
          <ZoomIn aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {isDocument && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || (view.zoom === 1 && !view.x && !view.y)}
              onClick={() => placeDocument(WHOLE_PICTURE)}
            >
              <Maximize2 />
              {translate('fitWholePicture')}
            </Button>
          )}
        </div>
        {odd && <p className="text-body-sm text-muted-foreground">{translate('logoFrameHint')}</p>}
        {progress !== null && (
          <span className="block h-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        )}
        {shown && (
          <p role="alert" className="text-body-sm text-destructive">
            {error && !problem ? `${translate('logoCouldNotBeUploaded')} ${error}` : shown}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {translate('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!ready || busy || !!problem || !!lowResolution}
            onClick={() => void save()}
          >
            {busy && (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            )}
            {busy ? translate('saving') : error ? translate('retry') : translate('useThisLogo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The workspace crop as it will be saved: on white, so a transparent logo shows as it will in the switcher. */
function CropPreview({
  url,
  area,
  className,
}: {
  url: string
  area: CropArea | undefined
  className: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative aspect-square shrink-0 overflow-hidden bg-white ring-1 ring-border',
        className,
      )}
    >
      {area && (
        <div
          className="absolute bg-size-[100%_100%]"
          style={{
            backgroundImage: `url(${JSON.stringify(url)})`,
            width: `${10000 / area.width}%`,
            height: `${10000 / area.height}%`,
            left: `${(-100 * area.x) / area.width}%`,
            top: `${(-100 * area.y) / area.height}%`,
          }}
        />
      )}
    </div>
  )
}
