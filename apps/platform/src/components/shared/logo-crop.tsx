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
import { LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Cropper from 'react-easy-crop'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { LOGO_MAX_BYTES, logoProblem, LOGO_TYPES } from '@/lib/invoices'
import {
  cropDocumentLogo,
  cropWorkspaceLogo,
  imageSize,
  isWholePicture,
  LOGO_MAX_SIDE,
  LOGO_MIN_SIDE,
  sizeProblem,
} from '@/lib/logo-crop'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
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
 * saved as a 512 px PNG that keeps its transparency. The document logo starts as the whole picture at its own
 * proportions; zooming in only trims it, and it is never stretched. Cancelling sends nothing; a failed upload keeps
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
  const [problem, setProblem] = useState('')
  const [encoding, setEncoding] = useState(false)
  const busy = saving || encoding
  const shown = problem || error
  const aspect = kind === 'workspace' ? 1 : natural ? natural.width / natural.height : 1

  const save = async () => {
    if (!area || !natural || busy) return
    setEncoding(true)
    setProblem('')
    try {
      // The whole picture, as picked, is sent as it is: the same bytes, so a duplicate is found.
      if (
        kind === 'document' &&
        file.size <= LOGO_MAX_BYTES &&
        LOGO_TYPES.includes(file.type) &&
        Math.max(natural.width, natural.height) <= LOGO_MAX_SIDE &&
        Math.min(natural.width, natural.height) >= LOGO_MIN_SIDE &&
        isWholePicture(area.pixels, natural.width, natural.height)
      ) {
        onSave(file)
        return
      }
      const bitmap = await createImageBitmap(file)
      try {
        const logo =
          kind === 'workspace'
            ? await cropWorkspaceLogo(bitmap, area.pixels)
            : await cropDocumentLogo(bitmap, area.pixels, file.type)
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div className="relative h-72 overflow-hidden rounded-lg bg-muted">
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              aspect={aspect}
              showGrid={false}
              objectFit={kind === 'workspace' ? 'cover' : 'contain'}
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
            {kind === 'workspace' ? (
              <>
                <CropPreview url={url} area={area?.percent} className="size-16 rounded-xl" />
                <CropPreview url={url} area={area?.percent} className="size-8 rounded-[9px]" />
              </>
            ) : (
              <CropPreview
                url={url}
                area={area?.percent}
                ratio={area ? area.pixels.width / area.pixels.height : aspect}
                className="w-28 rounded-md"
              />
            )}
            <figcaption className="text-body-sm text-muted-foreground">
              {translate('preview')}
            </figcaption>
          </figure>
        </div>
        <div className="flex items-center gap-3">
          <ZoomOut aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <Slider
            aria-label={translate('zoom')}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={ZOOM_STEP}
            value={[zoom]}
            onValueChange={([next]) => next !== undefined && setZoom(next)}
            disabled={busy}
          />
          <ZoomIn aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </div>
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
          <Button type="button" disabled={!area || busy || !!problem} onClick={() => void save()}>
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

/** The crop as it will be saved: on white, so a transparent logo shows as it will on paper and in the switcher. */
function CropPreview({
  url,
  area,
  ratio = 1,
  className,
}: {
  url: string
  area: CropArea | undefined
  ratio?: number
  className: string
}) {
  return (
    <div
      aria-hidden
      style={{ aspectRatio: ratio }}
      className={cn('relative shrink-0 overflow-hidden bg-white ring-1 ring-border', className)}
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
