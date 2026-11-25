'use client'
import { languageTag } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { Input } from '@helvetly/ui/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { CircleHelp, Copy, Link2, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { ActionRow, SettingsSection } from '@/components/settings/layout'
import { translate } from '@/lib/i18n'
import { useFeed, useMakeFeed, useRemoveFeed } from '@/lib/scheduling-settings'

/** The URL is a secret: only its end is shown, the whole of it is copied on request. */
export const maskedUrl = (url: string) => url.replace(/\/[^/]*$/, '/••••••••••••.ics')

const copy = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(translate('schedulingSettingsFeedCopied'))
  } catch {
    toast.error(translate('schedulingSettingsFeedCopyFailed'))
  }
}

/** The person's private iCal address, for Apple Calendar and anything else that subscribes. */
export function CalendarFeed() {
  const feed = useFeed()
  const make = useMakeFeed()
  const remove = useRemoveFeed()
  const [confirm, setConfirm] = useState<'rotate' | 'remove' | null>(null)
  const current = feed.data
  const create = (rotated: boolean) =>
    make.mutate(undefined, {
      onSuccess: () =>
        toast.success(
          rotated
            ? translate('schedulingSettingsFeedRotated')
            : translate('schedulingSettingsFeedCreated'),
        ),
      onError: toastError,
    })
  return (
    <SettingsSection
      id="calendar-feed"
      icon={Link2}
      title={translate('schedulingSettingsFeed')}
      description={translate('schedulingSettingsFeedDescription')}
    >
      {feed.isPending ? null : feed.error ? (
        <p className="text-body text-muted-foreground">
          {translate('schedulingSettingsLoadFailed')}
        </p>
      ) : current ? (
        <div className="grid max-w-[var(--settings-form,44rem)] gap-3">
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label={translate('schedulingSettingsFeedAddress')}
              value={maskedUrl(current.url)}
              className="font-code"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={translate('schedulingSettingsCopyFeed')}
                  onClick={() => void copy(current.url)}
                >
                  <Copy />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('schedulingSettingsCopyFeed')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={translate('schedulingSettingsFeedHelpLabel')}
                  className="inline-flex items-center rounded-full px-1 text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <CircleHelp className="size-4 stroke-[1.75]" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 text-pretty">
                {translate('schedulingSettingsFeedHelp')}
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-body-sm text-muted-foreground">
            {current.last_fetched_at
              ? translate('schedulingSettingsFeedFetched', {
                  time: new Intl.DateTimeFormat(languageTag, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(current.last_fetched_at)),
                })
              : translate('schedulingSettingsFeedNeverFetched')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirm('rotate')}>
              <RefreshCw />
              {translate('schedulingSettingsFeedRotate')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm('remove')}>
              <Trash2 />
              {translate('schedulingSettingsFeedRemove')}
            </Button>
          </div>
        </div>
      ) : (
        <ActionRow
          title={translate('schedulingSettingsFeedNone')}
          description={translate('schedulingSettingsFeedNoneBody')}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={make.isPending}
            onClick={() => create(false)}
          >
            <Link2 />
            {translate('schedulingSettingsFeedCreate')}
          </Button>
        </ActionRow>
      )}
      {confirm && (
        <ConfirmDialog
          tone="destructive"
          title={
            confirm === 'rotate'
              ? translate('schedulingSettingsFeedRotateTitle')
              : translate('schedulingSettingsFeedRemoveTitle')
          }
          body={
            confirm === 'rotate'
              ? translate('schedulingSettingsFeedRotateBody')
              : translate('schedulingSettingsFeedRemoveBody')
          }
          confirmLabel={
            confirm === 'rotate'
              ? translate('schedulingSettingsFeedRotate')
              : translate('schedulingSettingsFeedRemove')
          }
          onDecide={(approved) => {
            const action = confirm
            setConfirm(null)
            if (!approved) return
            if (action === 'rotate') create(true)
            else
              remove.mutate(undefined, {
                onSuccess: () => toast.success(translate('schedulingSettingsFeedRemoved')),
                onError: toastError,
              })
          }}
        />
      )}
    </SettingsSection>
  )
}
