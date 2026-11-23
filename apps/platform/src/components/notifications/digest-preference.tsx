'use client'
import { Switch } from '@helvetly/ui/components/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { FeatureLockNotice, useFeatureLock } from '@/components/billing/feature-lock'
import { HelpTip } from '@/components/settings/help-tip'
import {
  engagementSettingsKey,
  getEngagementSettings,
  putEngagementSettings,
} from '@/lib/engagements'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

/**
 * The daily e-mail digest (engagements to invoice or ending, plus dunning notices): one switch per workspace that
 * owners and admins hold, saved as soon as it is flipped. Turning it on needs engagement automation; off stays possible.
 */
export function DigestPreference() {
  const client = useQueryClient()
  const role = useSession().data?.role
  const canManage = role === 'owner' || role === 'admin'
  const lock = useFeatureLock('automations')
  const settings = useQuery({
    queryKey: engagementSettingsKey,
    queryFn: getEngagementSettings,
    enabled: canManage,
  })
  const toggle = useMutation({
    mutationFn: putEngagementSettings,
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: engagementSettingsKey })
      const before = client.getQueryData(engagementSettingsKey)
      client.setQueryData(engagementSettingsKey, body)
      return { before }
    },
    onError: (_error, _body, context) => {
      client.setQueryData(engagementSettingsKey, context?.before)
      toast.error(translate('couldNotChangeTheDailyDigest'))
    },
  })
  if (!canManage) return null
  const on = settings.data?.digest ?? false
  const title = translate('dailyEMailDigest')
  return (
    <div className="grid gap-2 rounded-lg border px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body font-medium">
          {title}
          <HelpTip label={translate('about', { children: title })}>
            {translate('dailyEMailDigestHelp')}
          </HelpTip>
        </span>
        <Switch
          aria-label={title}
          checked={on}
          // Switching off always works; only turning on needs the plan.
          disabled={!settings.data || (Boolean(lock) && !on)}
          onCheckedChange={(digest) => toggle.mutate({ digest })}
        />
      </div>
      {lock && !on && <FeatureLockNotice lock={lock} kept={translate('dailyEMailDigestKept')} />}
    </div>
  )
}
