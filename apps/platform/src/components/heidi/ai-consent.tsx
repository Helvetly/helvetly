'use client'

import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@helvetly/ui/components/dialog'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Clock,
  DatabaseZap,
  Globe,
  GraduationCap,
  History,
  MessageSquare,
  Paperclip,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { SettingsSection } from '@/components/settings/layout'
import { errorMessage, type ApiError } from '@/lib/api'
import { heidiApi, type HeidiConsent } from '@/lib/heidi'
import { useSession } from '@/lib/queries'

import { usageKey } from './use-heidi'

/** What turning consent on means, in one place for the panel and the settings card. */
export const CONSENT_TEXT =
  'Heidi then sends OpenAI (USA) the message you write, the last 20 messages of that conversation, which can include figures Heidi showed you, and the files you attach to it. Workspace records are not sent otherwise. OpenAI does not train on this data and may keep it for up to 30 days to detect abuse. Owners and admins can turn this off at any time.'

function useAIConsent() {
  const queryClient = useQueryClient()
  const role = useSession().data?.role
  const usage = useQuery({ queryKey: usageKey, queryFn: heidiApi.usage })
  const change = useMutation<{ data: HeidiConsent }, ApiError, boolean>({
    mutationFn: heidiApi.setConsent,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: usageKey }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  return {
    usage: usage.data,
    canManage: role === 'owner' || role === 'admin',
    change,
  }
}

/** Above Heidi's composer while the model is available but the workspace has not consented. */
export function AIConsentNotice() {
  const { usage, canManage, change } = useAIConsent()
  if (!usage?.provider_available || usage.consent?.granted) return null
  return (
    <div
      role="note"
      className="mb-2 grid gap-2 rounded-lg bg-muted px-3 py-2.5 text-[12.5px] text-muted-foreground"
    >
      <p className="text-pretty">
        <span className="font-medium text-foreground">AI answers are off.</span> Heidi answers from
        your records only. {CONSENT_TEXT}
      </p>
      {canManage ? (
        <div>
          <Button size="sm" disabled={change.isPending} onClick={() => change.mutate(true)}>
            {change.isPending ? 'Allowing…' : 'Allow OpenAI'}
          </Button>
        </div>
      ) : (
        <p>An owner or admin can allow it.</p>
      )}
    </div>
  )
}

const SHARED: { icon: LucideIcon; text: string; sent?: boolean }[] = [
  { icon: MessageSquare, text: 'The message you write', sent: true },
  {
    icon: History,
    text: 'The last 20 messages of that conversation, including figures Heidi showed you',
    sent: true,
  },
  { icon: Paperclip, text: 'Files you attach to it', sent: true },
  { icon: DatabaseZap, text: 'Not sent: any other workspace records' },
  { icon: GraduationCap, text: 'OpenAI doesn’t train on it' },
  { icon: Clock, text: 'Kept up to 30 days, only for abuse checks' },
  { icon: Globe, text: 'Processed by OpenAI in the USA' },
]

/** Who turned the consent on or off, and when; or that nobody has chosen yet. */
function consentStatus(consent: HeidiConsent | undefined): string {
  const off = 'Off: Heidi answers from your data only'
  if (!consent?.changed_at) return off
  const since = `since ${formatDate(consent.changed_at)} · by ${consent.changed_by}`
  return consent.granted ? `On ${since}` : `${off} · ${since}`
}

/** Workspace settings: the same consent as a switch, its status, and what it shares. */
export function AIConsentCard() {
  const { usage, canManage, change } = useAIConsent()
  if (!usage?.provider_available) return null
  const granted = change.isPending ? change.variables : (usage.consent?.granted ?? false)
  return (
    <SettingsSection
      id="ai-provider"
      icon={Sparkles}
      title="AI answers with OpenAI"
      description="Let Heidi use OpenAI for smarter answers. Owners and admins decide."
    >
      <SwitchRow
        id="ai-consent"
        label="Allow Heidi to use OpenAI"
        description={consentStatus(usage.consent)}
        checked={granted}
        disabled={change.isPending}
        disabledReason={canManage ? undefined : 'Only an owner or admin can change this.'}
        onCheckedChange={(next) => change.mutate(next)}
      />
      <Dialog>
        <div>
          <DialogTrigger asChild>
            <Button variant="link" size="sm" className="h-auto px-0">
              What Heidi shares with OpenAI
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What Heidi shares with OpenAI</DialogTitle>
            <DialogDescription>
              Only while AI answers are on, and only for your own chats.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2.5 text-body-sm">
            {SHARED.map(({ icon: Icon, text, sent }) => (
              <li key={text} className="flex items-start gap-2.5">
                <Icon
                  aria-hidden
                  className={cn(
                    'mt-px size-4 shrink-0 stroke-[1.75]',
                    sent ? 'text-foreground' : 'text-muted-foreground',
                  )}
                />
                <span className={sent ? undefined : 'text-muted-foreground'}>{text}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
