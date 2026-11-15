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
import { type CropArea, cropPhoto } from '@helvetly/ui/lib/photo'
import { cn } from '@helvetly/ui/lib/utils'
import { LoaderCircle, ZoomIn, ZoomOut } from 'lucide-react'
import { useState } from 'react'
import Cropper from 'react-easy-crop'

import { errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.1

/**
 * Square crop of a picked photo, with how the round avatar will look. Drag (or arrow keys) to move, the slider,
 * wheel or pinch to zoom; it starts centred and fills the square. Saving hands over a 512 × 512 JPEG.
 */
export function PhotoCropDialog({
  file,
  url,
  saving,
  error,
  onCancel,
  onSave,
}: {
  file: Blob
  /** An object URL of `file`, owned by the caller. */
  url: string
  saving: boolean
  error: string
  onCancel: () => void
  onSave: (photo: Blob) => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [area, setArea] = useState<{ percent: CropArea; pixels: CropArea } | null>(null)
  const [problem, setProblem] = useState('')
  const [cropping, setCropping] = useState(false)
  const busy = saving || cropping
  const shown = problem || error

  const save = async () => {
    if (!area || busy) return
    setCropping(true)
    setProblem('')
    try {
      const bitmap = await createImageBitmap(file)
      try {
        onSave(await cropPhoto(bitmap, area.pixels))
      } finally {
        bitmap.close()
      }
    } catch (failure) {
      setProblem(errorMessage(failure))
    } finally {
      setCropping(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('cropYourPhoto')}</DialogTitle>
          <DialogDescription>{translate('dragThePhotoToPlaceItAndZoomWith')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
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
          <figure className="flex items-center gap-3 sm:flex-col sm:items-center sm:pt-2">
            <CirclePreview url={url} area={area?.percent} className="size-24" />
            <CirclePreview url={url} area={area?.percent} className="size-10" />
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
        {shown && (
          <p role="alert" className="text-body-sm text-destructive">
            {shown}
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
            {busy ? translate('saving') : translate('savePhoto')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The crop as the round avatar shows it: the picture scaled so the cropped square fills the circle. */
function CirclePreview({
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
      className={cn('relative shrink-0 overflow-hidden rounded-full bg-muted', className)}
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
