'use client'
import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Callout, type CalloutTone } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import {
  BadgeCheck,
  Check,
  Circle,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Timer,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { useFeatureLock } from '@/components/billing/feature-lock'
import { toastError } from '@/components/billing/upgrade-prompt'
import { UpsellCard } from '@/components/billing/upsell-card'
import { ApiError } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  useAddPortalDomain,
  useCheckPortalDomain,
  usePortalDomain,
  useRemovePortalDomain,
  type DomainProblem,
  type DomainRecord,
  type DomainStage,
  type PortalDomain,
} from '@/lib/workspaces'

import { HelpTip } from './help-tip'
import { FieldGrid } from './layout'

/** What someone types or pastes ("https://Portal.Firma.ch/login") as the bare host the API expects. */
export function domainOf(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
}

const STAGES: Record<DomainStage, { tone: Tone; label: string }> = {
  dns: { tone: STATUS_TONES.portalDomain.dns, label: translate('domainStageDns') },
  certificate: {
    tone: STATUS_TONES.portalDomain.certificate,
    label: translate('domainStageCertificate'),
  },
  active: { tone: STATUS_TONES.portalDomain.active, label: translate('domainStageActive') },
  problem: { tone: STATUS_TONES.portalDomain.problem, label: translate('domainStageProblem') },
}

/** The notice above the records: its tone, a short title and one line of explanation, all from the API's stable codes. */
export function domainNotice(
  domain: Pick<PortalDomain, 'stage' | 'problem'>,
): { tone: CalloutTone; title: string; body: string } | null {
  const { stage, problem } = domain
  if (stage === 'active') return null
  // Only a domain that broke or was refused is a failure; waiting and a plan to upgrade are not.
  const tone: CalloutTone =
    stage === 'certificate'
      ? 'info'
      : stage === 'problem' && problem !== 'plan'
        ? 'danger'
        : 'warning'
  const key = problem ?? 'pending'
  return {
    tone,
    title: translate(NOTICE_KEYS[key].title),
    body: translate(NOTICE_KEYS[key].body),
  }
}

type MessageKey = Parameters<typeof translate>[0]

const NOTICE_KEYS: Record<DomainProblem | 'pending', { title: MessageKey; body: MessageKey }> = {
  pending: { title: 'domainTitlePending', body: 'domainProblemPending' },
  dns: { title: 'domainTitleDns', body: 'domainProblemDns' },
  verification: { title: 'domainTitleVerification', body: 'domainProblemVerification' },
  certificate: { title: 'domainTitleCertificate', body: 'domainProblemCertificate' },
  blocked: { title: 'domainTitleBlocked', body: 'domainProblemBlocked' },
  taken: { title: 'domainTitleTaken', body: 'domainProblemTaken' },
  plan: { title: 'domainTitlePlan', body: 'domainProblemPlan' },
}

/** What each record is for, in plain words. */
const RECORD_WHY: Record<string, string> = {
  CNAME: translate('dnsRecordCnameWhy'),
  TXT: translate('dnsRecordTxtWhy'),
}

/** The TXT record a 409 names when another workspace holds the domain unproven (error.details.verify). */
export function proofOf(failure: unknown): DomainRecord | undefined {
  if (!(failure instanceof ApiError) || failure.code !== 'domain_taken') return undefined
  const v = failure.details.verify
  if (typeof v !== 'object' || v === null) return undefined
  const { type, name, value } = v as Record<string, unknown>
  return typeof type === 'string' && typeof name === 'string' && typeof value === 'string'
    ? { type, name, value }
    : undefined
}

/** The API's refusals of a domain, in words; others keep the API's message. */
const REFUSALS: Record<string, string> = {
  domain_invalid: translate('domainInvalid'),
  domain_apex: translate('domainApex'),
  domain_reserved: translate('domainReserved'),
  domain_taken: translate('domainTaken'),
  domain_elsewhere: translate('domainElsewhere'),
  domain_exists: translate('domainExists'),
  domain_unavailable: translate('domainUnavailable'),
}

/**
 * The client portal at the workspace's own domain, as a row under its address: add it, the DNS records to create,
 * its status. On a plan without it the row stays, locked, with the way to the plans. Not there at all when the
 * server has no Cloudflare for SaaS settings.
 */
export function PortalDomainRow({
  canEdit,
  currentUrl,
}: {
  canEdit: boolean
  currentUrl?: string
}) {
  const settings = usePortalDomain().data
  const lock = useFeatureLock('custom_portal_domain')
  if (!settings?.enabled) return null
  const locked = Boolean(lock) && !settings.domain
  const body = settings.domain ? (
    <DomainStatus domain={settings.domain} canEdit={canEdit} />
  ) : lock ? (
    <UpsellCard
      lock={lock}
      title={translate('customDomainUpsellTitle')}
      pitch={translate('customDomainUpsellPitch', {
        example: translate('customDomainUpsellExample'),
      })}
      preview={currentUrl && <AddressPreview currentUrl={currentUrl} />}
      benefits={[
        { icon: BadgeCheck, text: translate('customDomainBenefitBrand') },
        { icon: ShieldCheck, text: translate('customDomainBenefitTls') },
        { icon: Timer, text: translate('customDomainBenefitSetup') },
      ]}
    />
  ) : canEdit ? (
    <AddDomain />
  ) : (
    <p className="text-body-sm text-muted-foreground">{translate('customDomainNone')}</p>
  )
  return (
    <div
      id="portal-domain"
      data-slot="portal-domain"
      data-locked={locked || undefined}
      className="grid gap-3 border-t pt-5"
    >
      <h3 className="flex items-center gap-1.5 text-body font-medium">
        {locked ? (
          <Lock aria-hidden className="size-3.5 text-muted-foreground" />
        ) : (
          <Link2 aria-hidden className="size-3.5 text-muted-foreground" />
        )}
        {translate('ownDomain')}
        <HelpTip label={translate('ownDomain')}>{translate('customDomainHelp')}</HelpTip>
      </h3>
      {body}
    </div>
  )
}

/** The portal's address now and at a domain of one's own, as two small address bars. */
function AddressPreview({ currentUrl }: { currentUrl: string }) {
  const now = currentUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return (
    <dl
      data-slot="address-preview"
      className="grid items-center gap-x-3 gap-y-1 text-body-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1.5"
    >
      <dt className="text-caption text-muted-foreground">{translate('customDomainUpsellNow')}</dt>
      <dd className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed bg-card/60 px-3 py-1.5 text-muted-foreground">
        <Globe aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{now}</span>
      </dd>
      <dt className="text-caption text-muted-foreground">{translate('customDomainUpsellThen')}</dt>
      <dd className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 font-medium max-sm:mb-1">
        <Lock aria-hidden className="size-3.5 shrink-0 text-success" />
        <span className="truncate">{translate('customDomainUpsellExample')}</span>
      </dd>
    </dl>
  )
}

function AddDomain() {
  const add = useAddPortalDomain()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  const [proof, setProof] = useState<DomainRecord>()
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const hostname = domainOf(value)
        if (!hostname.includes('.')) {
          setError(translate('domainInvalid'))
          return
        }
        setError(undefined)
        setProof(undefined)
        add.mutate(hostname, {
          onSuccess: () => toast.success(translate('customDomainAdded')),
          onError: (failure) => {
            const verify = proofOf(failure)
            const refusal = verify
              ? translate('domainTakenUnproven')
              : failure instanceof ApiError
                ? REFUSALS[failure.code]
                : undefined
            setProof(verify)
            if (refusal) setError(refusal)
            else toastError(failure)
          },
        })
      }}
    >
      <p className="max-w-[68ch] text-body-sm text-pretty text-muted-foreground">
        {translate('customDomainIntro')}
      </p>
      <FieldGrid>
        <FormField
          id="portal-domain-input"
          required
          label={translate('customDomainField')}
          width="md"
          error={error}
          hint={error ? undefined : translate('customDomainHint')}
        >
          <Input
            {...describedBy('portal-domain-input', error)}
            placeholder="portal.yourcompany.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            maxLength={253}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
      </FieldGrid>
      {proof && (
        <ul className="grid max-w-[var(--settings-form,44rem)] gap-2">
          <RecordRow record={proof} />
        </ul>
      )}
      <div>
        <Button type="submit" size="sm" disabled={add.isPending || value.trim() === ''}>
          {translate('addCustomDomain')}
        </Button>
      </div>
    </form>
  )
}

const SPIN = 'animate-spin motion-reduce:animate-none'

/** The three steps of going live, from the API's stage: DNS records, secure connection, live. */
function SetupSteps({ stage }: { stage: DomainStage }) {
  const at = stage === 'certificate' ? 1 : 0
  const steps = [
    translate('domainStepDns'),
    translate('domainStepSecure'),
    translate('domainStepLive'),
  ]
  return (
    <ol data-slot="domain-steps" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption">
      {steps.map((label, index) => {
        const state = index < at ? 'done' : index === at ? 'active' : 'pending'
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
            className={
              state === 'pending'
                ? 'flex items-center gap-1.5 text-muted-foreground'
                : 'flex items-center gap-1.5 font-medium'
            }
          >
            {state === 'done' ? (
              <Check aria-hidden className="size-3.5 text-success" />
            ) : state === 'active' ? (
              <Loader2 aria-hidden className={`size-3.5 ${SPIN}`} />
            ) : (
              <Circle aria-hidden className="size-3.5" />
            )}
            {label}
          </li>
        )
      })}
    </ol>
  )
}

function DomainStatus({ domain, canEdit }: { domain: PortalDomain; canEdit: boolean }) {
  const check = useCheckPortalDomain()
  const remove = useRemovePortalDomain()
  const [confirming, setConfirming] = useState(false)
  const stage = STAGES[domain.stage]
  const active = domain.stage === 'active'
  const notice = domainNotice(domain)
  // Once DNS is verified the records are only a reference.
  const collapsed = active || domain.stage === 'certificate'
  const records = (active ? domain.records.filter((r) => r.type === 'CNAME') : domain.records).map(
    (record) => <RecordRow key={`${record.type} ${record.name}`} record={record} />,
  )
  return (
    <div className="grid max-w-[var(--settings-form,44rem)] gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 truncate text-body font-medium">{domain.hostname}</span>
        <Badge tone={stage.tone}>{stage.label}</Badge>
        {canEdit && (
          <span className="ml-auto flex gap-2">
            {!active && (
              <Button
                size="sm"
                variant="outline"
                disabled={check.isPending}
                onClick={() => check.mutate(undefined, { onError: toastError })}
              >
                <RefreshCw className={check.isPending ? SPIN : undefined} />
                {translate('recheckDomain')}
              </Button>
            )}
            <Button size="sm" variant="destructive-ghost" onClick={() => setConfirming(true)}>
              <Trash2 />
              {translate('removeDomain')}
            </Button>
          </span>
        )}
      </div>
      {active && (
        <Callout
          tone="success"
          title={translate('domainLiveTitle', { domain: domain.hostname })}
          actions={
            <Button asChild size="sm" variant="outline">
              <a href={`https://${domain.hostname}/`} target="_blank" rel="noreferrer">
                <ExternalLink />
                {translate('domainOpen')}
              </a>
            </Button>
          }
        />
      )}
      {notice && (
        <Callout
          role={notice.tone === 'info' ? 'status' : 'alert'}
          tone={notice.tone}
          icon={notice.tone === 'info' ? Loader2 : undefined}
          iconClassName={notice.tone === 'info' ? SPIN : undefined}
          title={notice.title}
        >
          <p>{notice.body}</p>
          {(domain.stage === 'dns' || domain.stage === 'certificate') && (
            <SetupSteps stage={domain.stage} />
          )}
          {domain.releases_at && (
            <p className="mt-1 text-muted-foreground">
              {translate('domainReleasesAt', { date: formatDate(domain.releases_at) })}
            </p>
          )}
          {domain.detail && (
            <details className="mt-1 text-caption text-muted-foreground">
              <summary className="cursor-pointer underline underline-offset-2">
                {translate('domainTechnicalDetails')}
              </summary>
              <p className="font-code mt-1 break-words">{domain.detail}</p>
            </details>
          )}
        </Callout>
      )}
      {active && (
        <p className="text-caption text-muted-foreground">{translate('domainKeepCname')}</p>
      )}
      {collapsed ? (
        <details data-slot="dns-records" className="grid gap-2 text-body-sm">
          <summary className="w-fit cursor-pointer text-muted-foreground underline underline-offset-2">
            {translate('domainRecordsToggle')}
          </summary>
          <div className="mt-2 grid gap-2">
            {!active && (
              <p className="text-pretty text-muted-foreground">{translate('domainRecordsNote')}</p>
            )}
            <ul className="grid gap-2">{records}</ul>
          </div>
        </details>
      ) : (
        <>
          <p className="text-body-sm text-pretty text-muted-foreground">
            {translate('customDomainRecords')}
          </p>
          <ul className="grid gap-2">{records}</ul>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          tone="destructive"
          title={translate('removeDomainTitle', { domain: domain.hostname })}
          body={translate('removeDomainBody')}
          confirmLabel={translate('removeDomainConfirm')}
          onDecide={(approved) => {
            setConfirming(false)
            if (approved)
              remove.mutate(undefined, {
                onSuccess: () => toast.success(translate('customDomainRemoved')),
                onError: toastError,
              })
          }}
        />
      )}
    </div>
  )
}

/** One DNS record as the provider's form asks for it: type, name and value, each copied with one click. */
function RecordRow({ record }: { record: DomainRecord }) {
  return (
    <li className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2 text-body-sm @md:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)] @md:items-center @md:gap-3">
      <Field label={translate('dnsRecordType')}>
        <span className="font-code">{record.type}</span>
      </Field>
      <Field label={translate('dnsRecordName')}>
        <Copyable value={record.name} label={translate('copyDnsName')} />
      </Field>
      <Field label={translate('dnsRecordValue')}>
        <Copyable value={record.value} label={translate('copyDnsValue')} />
      </Field>
      {RECORD_WHY[record.type] && (
        <p className="text-caption text-muted-foreground @md:col-span-3">
          {RECORD_WHY[record.type]}
        </p>
      )}
    </li>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </span>
  )
}

function Copyable({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="font-code min-w-0 break-all">{value}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${label}: ${value}`}
            className="shrink-0 text-muted-foreground"
            onClick={() =>
              void navigator.clipboard
                .writeText(value)
                .then(() => toast.success(translate('dnsCopied')))
            }
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </span>
  )
}
