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
import { KeySquare, LoaderCircle, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
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
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
] as const
type ExpiryChoice = (typeof EXPIRIES)[number]['value']
const DAYS: Record<ExpiryChoice, TokenExpiry> = { '30': 30, '90': 90, '365': 365, never: null }
/** Badges a row shows before "+N". */
const MAX_BADGES = 3

function expiry(token: ApiToken) {
  if (!token.expires_at) return 'never expires'
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

  const empty = tokens.data?.length === 0
  // One "Create token": the empty state's primary action, else under the description.
  const createButton = (
    <Button size="sm" variant={empty ? 'default' : 'outline'} onClick={() => setCreating(true)}>
      <Plus /> Create token
    </Button>
  )

  return (
    <SettingsSection
      id="api-tokens"
      icon={KeySquare}
      title="API tokens"
      description={
        <>
          Let your own scripts and AI tools, such as Claude, work with Helvetly as you. A token acts
          in the workspace you create it in, with your role there and only the access you give it.{' '}
          <DocsLink>API reference</DocsLink>
        </>
      }
      action={!empty && createButton}
    >
      {tokens.isPending ? (
        <Loader className="min-h-9" />
      ) : tokens.error ? (
        <LoadError what="your API tokens" error={tokens.error} onRetry={() => tokens.refetch()} />
      ) : tokens.data.length === 0 ? (
        <SettingsEmpty icon={<KeySquare />} title="No API tokens yet" action={createButton}>
          Create one to connect a script or an AI assistant to Helvetly.
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
                  {token.workspace.name} · created {formatDate(token.created_at)} ·{' '}
                  {token.last_used_at
                    ? `used ${lastActive(token.last_used_at).toLowerCase()}`
                    : 'never used'}{' '}
                  · {expiry(token)}
                </>
              }
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive-ghost"
                    size="icon-sm"
                    aria-label={`Revoke ${token.name}`}
                    disabled={revoke.isPending && revoke.variables === token.id}
                    onClick={() => setRevoking(token)}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Revoke token</TooltipContent>
              </Tooltip>
            </SettingsRow>
          ))}
        </ul>
      )}
      {creating && <CreateTokenSheet onClose={() => setCreating(false)} />}
      {revoking && (
        <ConfirmDialog
          key={revoking.id}
          title={`Revoke “${revoking.name}”?`}
          body="Scripts and AI tools using this token stop working at once. This can’t be undone."
          confirmLabel="Revoke"
          tone="destructive"
          onDecide={(approved) => {
            setRevoking(null)
            if (approved)
              revoke.mutate(revoking.id, {
                onSuccess: () => toast.success('Token revoked.'),
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
    if (!name.trim()) missing.name = 'Enter a name.'
    if (scopes.length === 0) missing.scopes = 'Choose at least one thing the token may read.'
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
              {created ? 'Your new token' : 'Create API token'}
            </SheetTitle>
            <SheetDescription className="text-body-sm text-pretty text-muted-foreground">
              {created
                ? `${created.name} · ${scopeBadges(created.scopes)
                    .map((badge) => badge.label)
                    .join(', ')} · ${created.workspace.name}`
                : 'For a script or an AI tool that works with Helvetly as you.'}
            </SheetDescription>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
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
                label="Name"
                required
                error={errors.name}
                tip="Only for you, to recognise the token in this list."
              >
                <Input
                  {...describedBy('token-name', errors.name)}
                  autoComplete="off"
                  maxLength={80}
                  placeholder="Claude"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>
              <FormField
                id="token-scopes"
                label="Access"
                error={preset === 'custom' ? undefined : errors.scopes}
                tip="What the token may read and change. It never goes beyond your own role in the workspace."
              >
                <Segmented
                  label="Access"
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
                label="Expires"
                error={errors.expires_in_days}
                tip="After this the token stops working. You can revoke it at any time."
              >
                <Segmented
                  label="Expires"
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
                Create token
              </Button>
              <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>
                Cancel
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
        <Callout tone="warning" icon={TriangleAlert} title="Copy it now">
          Helvetly shows this token only once. Store it somewhere safe, such as a password manager.
          If you lose it, revoke it and create a new one.
        </Callout>
        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium">Token</p>
          <Snippet label="Token" value={token.token} />
        </div>
        <div className="grid gap-1.5">
          <p className="text-body-sm font-medium">REST API</p>
          <p className="text-body-sm text-muted-foreground">Send this header with each request.</p>
          <Snippet label="Header" value={`Authorization: Bearer ${token.token}`} />
        </div>
        <div className="grid gap-2">
          <p className="text-body-sm font-medium">Connect an AI assistant</p>
          <McpConnect origin={apiOrigin} token={token.token} />
        </div>
        <p className="text-body-sm text-muted-foreground">
          Endpoints and examples are in the <DocsLink>API reference</DocsLink>.
        </p>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3 sm:px-5">
        <Button onClick={onDone}>Done</Button>
      </footer>
    </>
  )
}
