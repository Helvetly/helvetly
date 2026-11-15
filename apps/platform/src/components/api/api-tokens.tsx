'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'
import { KeySquare, LoaderCircle, Lock, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { Snippet } from '@/components/developers/snippet'
import { LoadError } from '@/components/load-error'
import { apiFieldErrors, type FieldErrors } from '@/components/section-form'
import { SettingsEmpty, SettingsRow, SettingsSection } from '@/components/settings/layout'
import {
  lastActive,
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  type ApiToken,
  type NewApiToken,
  type TokenExpiry,
} from '@/lib/account'
import { errorMessage } from '@/lib/api'
import { useApiOrigin } from '@/lib/api-origin'
import { useLockedFeature } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  emptyMatrix,
  matrixScopes,
  PRESETS,
  scopeBadges,
  type Preset,
  type ScopeMatrix,
  type TokenScope,
} from '@/lib/token-scopes'

import { DocsLink } from './code-block'
import { McpConnect } from './mcp-connect'
import { ScopeMatrixField, TokenSummary } from './token-scopes'

const EXPIRIES = [
  { value: '30', label: translate('message30Days') },
  { value: '90', label: translate('message90Days') },
  { value: '365', label: translate('message1Year') },
  { value: 'never', label: translate('never') },
] as const
type ExpiryChoice = (typeof EXPIRIES)[number]['value']
const DAYS: Record<ExpiryChoice, TokenExpiry> = { '30': 30, '90': 90, '365': 365, never: null }
/** Badges a row shows before "+N". */
const MAX_BADGES = 3

function expiry(token: ApiToken) {
  if (!token.expires_at) return translate('neverExpires')
  const past = new Date(token.expires_at).getTime() < Date.now()
  return `${past ? 'expired' : 'expires'} ${formatDate(token.expires_at)}`
}

/** A token's access as compact badges; the rest behind "+N" with all of them in its tooltip. */
function ScopeBadges({ scopes }: { scopes: string[] }) {
  const badges = scopeBadges(scopes)
  const hidden = badges.slice(MAX_BADGES)
  return (
    <>
      {badges.slice(0, MAX_BADGES).map((badge) => (
        <StatusBadge key={badge.label} tone={badge.tone}>
          {badge.label}
        </StatusBadge>
      ))}
      {hidden.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded-[4px] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <StatusBadge>+{hidden.length}</StatusBadge>
            </button>
          </TooltipTrigger>
          <TooltipContent>{hidden.map((badge) => badge.label).join(', ')}</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}

/** Personal tokens for scripts and AI tools (the REST API and MCP), each bound to one workspace. */
export function ApiTokens() {
  const tokens = useApiTokens()
  const revoke = useRevokeApiToken()
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const locked = useLockedFeature('api_access')

  const empty = tokens.data?.length === 0
  // One "Create token": the empty state's primary action, else under the description.
  const createButton = (
    <Button
      size="sm"
      variant={empty ? 'default' : 'outline'}
      disabled={Boolean(locked)}
      onClick={() => setCreating(true)}
    >
      <Plus />
      {translate('createToken2')}
    </Button>
  )

  return (
    <SettingsSection
      id="api-tokens"
      icon={KeySquare}
      title={translate('apiTokens')}
      description={
        <>
          {translate('letYourOwnScriptsAndAIToolsSuchAs')}{' '}
          <DocsLink>{translate('apiReference')}</DocsLink>
        </>
      }
      action={!empty && createButton}
    >
      {locked && (
        <Callout
          className="mb-4"
          icon={Lock}
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/billing/plans">{translate('seePlans')}</Link>
            </Button>
          }
        >
          {locked.plan
            ? translate('newAPITokensComeWithThePlan', { name: locked.plan.name })
            : translate('yourPlanDoesNotIncludeNewAPITokens')}{' '}
          {translate('tokensYouAlreadyHaveKeepWorking')}
        </Callout>
      )}
      {tokens.isPending ? (
        <Loader className="min-h-9" />
      ) : tokens.error ? (
        <LoadError
          what={translate('yourAPITokens')}
          error={tokens.error}
          onRetry={() => tokens.refetch()}
        />
      ) : tokens.data.length === 0 ? (
        <SettingsEmpty
          icon={<KeySquare />}
          title={translate('noAPITokensYet')}
          action={createButton}
        >
          {translate('createOneToConnectAScriptOrAnAI')}
        </SettingsEmpty>
      ) : (
        <ul className="divide-y">
          {tokens.data.map((token) => (
            <SettingsRow
              key={token.id}
              icon={<KeySquare />}
              title={
                <>
                  {token.name}
                  <ScopeBadges scopes={token.scopes} />
                </>
              }
              meta={
                <>
                  <span className="font-mono text-caption">{token.prefix}…</span> ·{' '}
                  {token.workspace.name}
                  {translate('created')}
                  {formatDate(token.created_at)} ·{' '}
                  {token.last_used_at
                    ? `used ${lastActive(token.last_used_at).toLowerCase()}`
                    : translate('neverUsed')}{' '}
                  · {expiry(token)}
                </>
              }
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    aria-label={translate('revoke3', { name: token.name })}
                    disabled={revoke.isPending && revoke.variables === token.id}
                    onClick={() => setRevoking(token)}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{translate('revokeToken')}</TooltipContent>
              </Tooltip>
            </SettingsRow>
          ))}
        </ul>
      )}
      {creating && <CreateTokenSheet onClose={() => setCreating(false)} />}
      {revoking && (
        <ConfirmDialog
          key={revoking.id}
          title={translate('revoke2', { name: revoking.name })}
          body={translate('scriptsAndAIToolsUsingThisTokenStopWorking')}
          confirmLabel={translate('revoke')}
          tone="destructive"
          onDecide={(approved) => {
            setRevoking(null)
            if (approved)
              revoke.mutate(revoking.id, {
                onSuccess: () => toast.success(translate('tokenRevoked')),
                onError: toastError,
              })
          }}
        />
      )}
    </SettingsSection>
  )
}

const withoutScopesError = (errors: FieldErrors): FieldErrors => {
  const next = { ...errors }
  delete next.scopes
  return next
}

function CreateTokenSheet({ onClose }: { onClose: () => void }) {
  const create = useCreateApiToken()
  const [name, setName] = useState('')
  const [preset, setPreset] = useState<Preset>('read')
  const [matrix, setMatrix] = useState<ScopeMatrix>(emptyMatrix)
  const [expires, setExpires] = useState<ExpiryChoice>('90')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [created, setCreated] = useState<NewApiToken | null>(null)

  const presetScopes: readonly TokenScope[] =
    PRESETS.find((option) => option.value === preset)?.scopes ?? []
  const scopes = preset === 'custom' ? matrixScopes(matrix) : [...presetScopes]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const missing: FieldErrors = {}
    if (!name.trim()) missing.name = translate('enterAName')
    if (scopes.length === 0) missing.scopes = translate('chooseAtLeastOneThingTheTokenMayRead')
    setErrors(missing)
    if (Object.keys(missing).length > 0) return
    create.mutate(
      { name: name.trim(), scopes, expires_in_days: DAYS[expires] },
      {
        onSuccess: setCreated,
        onError: (error) => {
          const fields = apiFieldErrors(error)
          if (fields) setErrors(fields)
          else toast.error(errorMessage(error))
        },
      },
    )
  }

  return (
    <Sheet open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 bg-card p-0 sm:w-[min(560px,100vw)]!"
      >
        <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <SheetTitle className="text-body font-medium">
              {created ? translate('yourNewToken') : translate('createAPIToken')}
            </SheetTitle>
            <SheetDescription className="text-body-sm text-pretty text-muted-foreground">
              {created
                ? `${created.name} · ${scopeBadges(created.scopes)
                    .map((badge) => badge.label)
                    .join(', ')} · ${created.workspace.name}`
                : translate('forAScriptOrAnAIToolThatWorks')}
            </SheetDescription>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={translate('close')}
            disabled={create.isPending}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>
        {created ? (
          <Secret token={created} onDone={onClose} />
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-4 py-5 sm:px-5">
              <FormField
                id="token-name"
                label={translate('name')}
                required
                error={errors.name}
                tip={translate('onlyForYouToRecogniseTheTokenInThis')}
              >
                <Input
                  {...describedBy('token-name', errors.name)}
                  autoComplete="off"
                  maxLength={80}
                  placeholder={translate('claude')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField
                id="token-scopes"
                required
                label={translate('access')}
                error={preset === 'custom' ? undefined : errors.scopes}
                tip={translate('whatTheTokenMayReadAndChangeItNever')}
              >
                <Segmented
                  label={translate('access')}
                  fill
                  value={preset}
                  options={PRESETS.map(({ value, label }) => ({ value, label }))}
                  onChange={(value) => {
                    setPreset(value)
                    setErrors(withoutScopesError)
                  }}
                />
              </FormField>
              {preset === 'custom' && (
                <ScopeMatrixField
                  value={matrix}
                  error={errors.scopes}
                  onChange={(next) => {
                    setMatrix(next)
                    setErrors(withoutScopesError)
                  }}
                />
              )}
              <FormField
                id="token-expiry"
                label={translate('expires')}
                error={errors.expires_in_days}
                tip={translate('afterThisTheTokenStopsWorkingYouCanRevoke')}
              >
                <Segmented
                  label={translate('expires')}
                  fill
                  value={expires}
                  options={[...EXPIRIES]}
                  onChange={setExpires}
                />
              </FormField>
              <TokenSummary scopes={scopes} expiresInDays={DAYS[expires]} />
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
                {translate('createToken')}
              </Button>
              <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>
                {translate('cancel')}
              </Button>
            </footer>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** The secret, shown this once, and how to use it. */
function Secret({ token, onDone }: { token: NewApiToken; onDone: () => void }) {
  const apiOrigin = useApiOrigin()
  return (
    <>
      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-4 py-5 sm:px-5">
        <Callout tone="warning" icon={TriangleAlert} title={translate('copyItNow')}>
          {translate('helvetlyShowsThisTokenOnlyOnceStoreItSomewhere')}
        </Callout>
        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium">{translate('token')}</p>
          <Snippet label={translate('token')} value={token.token} />
        </div>
        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium">{translate('restAPI')}</p>
          <p className="text-body-sm text-muted-foreground">
            {translate('sendThisHeaderWithEachRequest')}
          </p>
          <Snippet label={translate('header')} value={`Authorization: Bearer ${token.token}`} />
        </div>
        <div className="grid gap-2">
          <p className="text-body-sm font-medium">{translate('connectAnAIAssistant')}</p>
          <McpConnect origin={apiOrigin} token={token.token} />
        </div>
        <p className="text-body-sm text-muted-foreground">
          {translate('endpointsAndExamplesAreInThe')}
          <DocsLink>{translate('apiReference')}</DocsLink>.
        </p>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
        <Button onClick={onDone}>{translate('done')}</Button>
      </footer>
    </>
  )
}
