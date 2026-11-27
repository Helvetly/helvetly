'use client'

import { Button } from '@helvetly/ui/components/button'
import { Switch } from '@helvetly/ui/components/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain } from 'lucide-react'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { ActionRow, SettingsSection } from '@/components/settings/layout'
import { useAI } from '@/lib/ai'
import { errorMessage, request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

type Memory = {
  enabled: boolean
  has_memory: boolean
  topics: { title: string; count: number }[]
}
type Change = { enabled: boolean } | 'clear'

export function HeidiMemorySettings() {
  const session = useSession().data
  const available = useAI('heidi').available
  const lock = useFeatureLock('heidi')
  const canUse = available && !lock
  const client = useQueryClient()
  const key = ['heidi', 'memory', session?.workspace.id, session?.user.id]
  const memory = useQuery({
    queryKey: key,
    queryFn: () => request<Memory>('/heidi/memory'),
    enabled: !!session,
  })
  const save = useMutation({
    mutationFn: (change: Change) =>
      request<Memory>(
        '/heidi/memory',
        change === 'clear' ? { method: 'DELETE' } : { method: 'PATCH', json: change },
      ),
    onSuccess: (updated) => {
      client.setQueryData(key, updated)
      void client.invalidateQueries({ queryKey: ['heidi', 'suggestions'] })
    },
  })
  const data = memory.data
  if (!canUse && !data?.has_memory) return null
  return (
    <SettingsSection
      id="heidi-memory"
      title={translate('heidiMemory')}
      icon={Brain}
      description={translate('heidiMemoryDescription')}
    >
      {data && (
        <fieldset disabled={save.isPending} className="grid gap-4">
          <legend className="sr-only">{translate('heidiMemory')}</legend>
          <ActionRow
            title={<label htmlFor="heidi-learning">{translate('heidiLearnTopics')}</label>}
            description={translate('heidiDisableMemory')}
          >
            <Switch
              id="heidi-learning"
              checked={data.enabled}
              onCheckedChange={(enabled) => save.mutate({ enabled })}
            />
          </ActionRow>
          {data.enabled && (
            <>
              <div className="grid gap-2">
                <h3 className="text-body font-medium">{translate('heidiLearnedTopics')}</h3>
                {data.topics.length ? (
                  <ul className="grid gap-1">
                    {data.topics.map(({ title, count }) => (
                      <li key={title} className="text-body-sm">
                        {translate('heidiTopicCount', { title, count })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-sm text-muted-foreground">{translate('heidiNoTopics')}</p>
                )}
              </div>
              {data.has_memory && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => save.mutate('clear')}
                >
                  {translate('heidiClearMemory')}
                </Button>
              )}
            </>
          )}
        </fieldset>
      )}
      {memory.isLoading && <output>{translate('loading')}</output>}
      {(memory.error || save.error) && (
        <div role="alert" className="text-body-sm text-destructive">
          {errorMessage(memory.error ?? save.error)}
          {memory.error && (
            <Button size="sm" variant="ghost" onClick={() => void memory.refetch()}>
              {translate('retry')}
            </Button>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
