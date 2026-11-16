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
import { LOGO_MAX_BYTES, logoProblem, LOGO_TYPES } from '@/lib/invoices'
import {
  clampView,
  cropWorkspaceLogo,
  DOCUMENT_MAX_ZOOM,
  DOCUMENT_MIN_ZOOM,
  imageSize,
  isWholePicture,
  LOGO_MAX_SIDE,
  LOGO_MIN_SIDE,
  renderDocumentLogo,
  sizeProblem,
  WHOLE_PICTURE,
  type DocumentView,
} from '@/lib/logo-crop'

import { DocumentLogoFrame } from './document-logo-frame'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
// Shapes this far from the 2.5 : 1 field get a word on how they are placed.
const ODD_RATIO = [1.4, 6] as const
const ZOOM_STEP = 0.1
// What the server keeps a workspace's mark to; the browser saves 512 × 512 (lib/logo-crop.ts).
const WORKSPACE_MAX_SIDE = 1024

export type LogoKind = 'workspace' | 'document'

/** Why a picked file cannot be cropped into a logo (translated), or null; the dimensions come from its header. */
export async function pickProblem(file: File, kind: LogoKind) {
  const problem = logoProblem(file)
  if (problem) return problem
  const size = await imageSize(file)
  if (!size || sizeProblem(size.width, size.height) === 'unreadable')
    return translate('thisImageCanTBeReadChooseAPNG')
  if (sizeProblem(size.width, size.height) === 'too-large')
    return translate('logoSizeLimits', {
      min: LOGO_MIN_SIDE,
      max: kind === 'workspace' ? WORKSPACE_MAX_SIDE : LOGO_MAX_SIDE,
    })
  return null
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
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null)
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
    void pickProblem(file, kind).then((problem) => {
      setPickError(problem ?? '')
      setUploadError('')
      if (!problem) setPicked({ file, url: URL.createObjectURL(file) })
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
  url,
  saving,
  progress,
  error,
  onCancel,
  onSave,
}: {
  kind: LogoKind
  file: File
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
  const [encoding, setEncoding] = useState(false)
  const busy = saving || encoding
  const shown = problem || error
  const isDocument = kind === 'document'
  const ready = isDocument ? !!natural : !!area
  const ratio = natural ? natural.width / natural.height : 1
  const odd = isDocument && natural && (ratio < ODD_RATIO[0] || ratio > ODD_RATIO[1])

  // The document logo's size comes from the file's header; the workspace cropper reports its own once loaded.
  useEffect(() => {
    if (isDocument) void imageSize(file).then((size) => size && setNatural(size))
  }, [isDocument, file])

  const zoomTo = (next: number) => {
    if (isDocument && natural) setView(clampView(natural, { ...view, zoom: next }))
    else setZoom(next)
  }

  const save = async () => {
    if (!ready || !natural || busy) return
    setEncoding(true)
    setProblem('')
    try {
      // A picture that already has the field's shape, shown whole, is sent as picked: the same bytes, so a duplicate is found.
      if (
        isDocument &&
        file.size <= LOGO_MAX_BYTES &&
        LOGO_TYPES.includes(file.type) &&
        Math.max(natural.width, natural.height) <= LOGO_MAX_SIDE &&
        Math.min(natural.width, natural.height) >= LOGO_MIN_SIDE &&
        isWholePicture(natural, view)
      ) {
        onSave(file)
        return
      }
      const bitmap = await createImageBitmap(file)
      try {
        const logo =
          !isDocument && area
            ? await cropWorkspaceLogo(bitmap, area.pixels)
            : await renderDocumentLogo(bitmap, natural, view)
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
              onChange={setView}
              onError={() => setProblem(translate('thisImageCanTBeReadChooseAPNG'))}
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
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onMediaLoaded={(media) =>
                  setNatural({ width: media.naturalWidth, height: media.naturalHeight })
                }
                onCropComplete={(percent, pixels) => setArea({ percent, pixels })}
                mediaProps={{
                  onError: () => setProblem(translate('thisImageCanTBeReadChooseAPNG')),
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
              onClick={() => setView(WHOLE_PICTURE)}
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
          <Button type="button" disabled={!ready || busy || !!problem} onClick={() => void save()}>
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
