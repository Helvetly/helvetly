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
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'

import { usageKey } from './use-heidi'

/** What turning consent on means, in one place for the panel and the settings card. */
export const CONSENT_TEXT = translate('heidiThenSendsOpenAIUSATheMessageYouWrite')

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
        <span className="font-medium text-foreground">{translate('aiAnswersAreOff')}</span>
        {translate('heidiAnswersFromYourRecordsOnly')}
        {CONSENT_TEXT}
      </p>
      {canManage ? (
        <div>
          <Button size="sm" disabled={change.isPending} onClick={() => change.mutate(true)}>
            {change.isPending ? translate('allowing') : translate('allowOpenAI')}
          </Button>
        </div>
      ) : (
        <p>{translate('anOwnerOrAdminCanAllowIt')}</p>
      )}
    </div>
  )
}

const SHARED: { icon: LucideIcon; text: string; sent?: boolean }[] = [
  { icon: MessageSquare, text: translate('theMessageYouWrite'), sent: true },
  {
    icon: History,
    text: translate('theLast20MessagesOfThatConversationIncludingFigures'),
    sent: true,
  },
  { icon: Paperclip, text: translate('filesYouAttachToIt'), sent: true },
  { icon: DatabaseZap, text: translate('notSentAnyOtherWorkspaceRecords') },
  { icon: GraduationCap, text: translate('openaiDoesnTTrainOnIt') },
  { icon: Clock, text: translate('keptUpTo30DaysOnlyForAbuseChecks') },
  { icon: Globe, text: translate('processedByOpenAIInTheUSA') },
]

/** Who turned the consent on or off, and when; or that nobody has chosen yet. */
function consentStatus(consent: HeidiConsent | undefined): string {
  const off = translate('offHeidiAnswersFromYourDataOnly')
  if (!consent?.changed_at) return off
  const since = translate('sinceBy', {
    value1: formatDate(consent.changed_at),
    changed_by: consent.changed_by,
  })
  return consent.granted ? translate('on2', { since: since }) : `${off} · ${since}`
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
      title={translate('aiAnswersWithOpenAI')}
      description={translate('letHeidiUseOpenAIForSmarterAnswersOwnersAnd')}
    >
      <SwitchRow
        id="ai-consent"
        label={translate('allowHeidiToUseOpenAI')}
        description={consentStatus(usage.consent)}
        checked={granted}
        disabled={change.isPending}
        disabledReason={canManage ? undefined : translate('onlyAnOwnerOrAdminCanChangeThis')}
        onCheckedChange={(next) => change.mutate(next)}
      />
      <Dialog>
        <div>
          <DialogTrigger asChild>
            <Button variant="link" size="sm" className="h-auto px-0">
              {translate('whatHeidiSharesWithOpenAI')}
            </Button>
          </DialogTrigger>
        </div>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{translate('whatHeidiSharesWithOpenAI')}</DialogTitle>
            <DialogDescription>{translate('onlyWhileAIAnswersAreOnAndOnlyFor')}</DialogDescription>
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
