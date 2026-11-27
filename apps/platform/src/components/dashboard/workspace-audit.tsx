'use client'

import { languageTag } from '@helvetly/i18n'
import { Badge, TONES, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { Segmented } from '@helvetly/ui/components/segmented'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { cn } from '@helvetly/ui/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronRight, FileSearch, LoaderCircle, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { useAIApproval } from '@/components/ai/ai-approval'
import { featureLock, PLANS_HREF, PlanTag } from '@/components/billing/feature-lock'
import { RecordLink } from '@/components/record-link'
import { useAI } from '@/lib/ai'
import { ApiError, errorMessage } from '@/lib/api'
import { billingKeys, usageItems, useBilling, type UsageItem } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import {
  auditAreas,
  auditLevels,
  auditScopes,
  auditTally,
  evidenceHref,
  fetchAudit,
  findingCopy,
  findingGroups,
  findingValues,
  inspectOriginal,
  type AuditArea,
  type AuditFinding,
  type WorkspaceAudit,
} from '@/lib/workspace-audit'

const tones: Record<keyof typeof auditLevels, Tone> = {
  critical: 'red',
  high: 'amber',
  medium: 'blue',
  low: 'neutral',
}

function Row({ item }: { item: AuditFinding }) {
  const values = findingValues(item)
  return (
    <li className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-baseline">
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        {values.length ? (
          values.map((v) => (
            <span key={`${v.label}:${v.value}`} className="break-words">
              {v.label && <span className="text-muted-foreground">{v.label} </span>}
              <span className="font-medium">{v.value}</span>
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
        {item.evidence.map((e) => (
          <RecordLink
            className="max-w-full truncate text-primary underline"
            href={evidenceHref(e)}
            key={e.kind + e.id}
            title={e.label || e.id}
          >
            {e.label || e.id}
          </RecordLink>
        ))}
      </span>
      {item.advice && (
        <p className="break-words text-muted-foreground sm:col-span-2">{item.advice}</p>
      )}
    </li>
  )
}

function Group({ items }: { items: [AuditFinding, ...AuditFinding[]] }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(12)
  const first = items[0]
  const [title, advice] = findingCopy(first.code)
  return (
    <details
      className="group rounded-lg border bg-card"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-body-sm">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
        />
        <Badge tone={tones[first.severity]} size="sm" className="w-16 justify-center">
          {auditLevels[first.severity]}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        <span className="shrink-0 text-caption text-muted-foreground max-sm:hidden">
          {auditAreas[first.category]}
        </span>
        <Badge size="sm" className="tabular-nums">
          {items.length}
        </Badge>
      </summary>
      {open && (
        <div className="border-t px-3 pb-2 text-body-sm sm:px-4">
          {advice && first.code !== 'source_observation' && (
            <p className="pt-2.5 text-caption text-muted-foreground">{advice}</p>
          )}
          <ol className="divide-y">
            {items.slice(0, limit).map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ol>
          {items.length > limit && (
            <Button
              size="sm"
              variant="outline"
              className="mb-1"
              onClick={() => setLimit(limit + 30)}
            >
              {translate('workspaceAuditMore')}
            </Button>
          )}
        </div>
      )}
    </details>
  )
}

function Results({ report, running }: { report: WorkspaceAudit; running: boolean }) {
  const [area, setArea] = useState('')
  const [level, setLevel] = useState('')
  const tally = useMemo(() => auditTally(report.findings), [report.findings])
  const groups = useMemo(
    () => findingGroups(report.findings, area, level),
    [report.findings, area, level],
  )
  if (!report.findings.length)
    return running ? null : (
      <p className={cn('flex items-center gap-2 rounded-lg p-3 text-body-sm', TONES.green)}>
        <CheckCheck aria-hidden className="size-4" />
        {translate('workspaceAuditClear')}
      </p>
    )
  return (
    <>
      <section aria-label={translate('workspaceAuditSeverity')} className="grid gap-2">
        <h3 className="text-body-sm font-medium">
          {translate('workspaceAuditSummary', { count: report.findings.length })}
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(auditLevels).map(([key, label]) => {
            const count = Object.entries(tally.severity).find(([k]) => k === key)?.[1] ?? 0
            const tone = Object.entries(tones).find(([k]) => k === key)?.[1] ?? 'neutral'
            return (
              <button
                key={key}
                type="button"
                aria-pressed={level === key}
                disabled={!count}
                onClick={() => setLevel(level === key ? '' : key)}
                className={cn(
                  'grid min-w-0 rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                  TONES[tone],
                  level === key && 'border-(color:--badge-ink)/40',
                )}
              >
                <span className="text-title-sm font-semibold tabular-nums">{count}</span>
                <span className="truncate text-caption">{label}</span>
              </button>
            )
          })}
        </div>
      </section>
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{translate('workspaceAuditAreas')}</legend>
        <Button
          size="sm"
          variant={area ? 'outline' : 'secondary'}
          aria-pressed={!area}
          onClick={() => setArea('')}
        >
          {translate('workspaceAuditAllAreas')}
        </Button>
        {Object.entries(auditAreas).flatMap(([key, label]) => {
          const count = Object.entries(tally.area).find(([k]) => k === key)?.[1]
          return count
            ? [
                <Button
                  key={key}
                  size="sm"
                  variant={area === key ? 'secondary' : 'outline'}
                  aria-pressed={area === key}
                  onClick={() => setArea(area === key ? '' : key)}
                >
                  {label}
                  <span className="text-muted-foreground tabular-nums">{count}</span>
                </Button>,
              ]
            : []
        })}
      </fieldset>
      {groups.length ? (
        <div className="grid gap-2">
          {groups.map(([key, items]) => (
            <Group key={key} items={items} />
          ))}
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">{translate('workspaceAuditNoMatch')}</p>
      )}
    </>
  )
}

function ScopeDialog({
  open,
  onOpenChange,
  initial,
  hasReport,
  allowance,
  checkingAllowance,
  onShowReport,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: AuditArea[]
  hasReport: boolean
  allowance: Pick<UsageItem, 'used' | 'max'> | undefined
  checkingAllowance: boolean
  onShowReport: () => void
  onStart: (areas: AuditArea[]) => void
}) {
  const [mode, setMode] = useState<'full' | 'areas'>(initial.length ? 'areas' : 'full')
  const [picked, setPicked] = useState<AuditArea[]>(initial)
  const ready = mode === 'full' || picked.length > 0
  const limit = allowance?.max ?? null
  const remaining = limit === null ? null : Math.max(0, limit - (allowance?.used ?? 0))
  let allowanceText = ''
  if (checkingAllowance) allowanceText = translate('workspaceAuditCheckingAllowance')
  else if (!allowance) allowanceText = translate('workspaceAuditAllowanceUnavailable')
  else if (remaining === 0) allowanceText = translate('workspaceAuditLimitReached')
  else if (remaining !== null && limit !== null) {
    allowanceText = translate('workspaceAuditRunsLeft', { remaining, limit })
  }
  const id = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-heidi" />
            {translate('workspaceAuditAudit')}
          </DialogTitle>
          <DialogDescription>{translate('workspaceAuditScopeDescription')}</DialogDescription>
        </DialogHeader>
        <Segmented
          label={translate('workspaceAuditScope')}
          value={mode}
          options={[
            { value: 'full', label: translate('workspaceAuditScopeFull') },
            { value: 'areas', label: translate('workspaceAuditScopeAreas') },
          ]}
          onChange={setMode}
        />
        {mode === 'areas' ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {auditScopes.map(([key, title, hint]) => (
              <li key={key}>
                <label
                  htmlFor={id + key}
                  className={cn(
                    'flex h-full cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/50',
                    picked.includes(key) && 'border-primary/40 bg-primary/5 hover:bg-primary/5',
                  )}
                >
                  <Checkbox
                    id={id + key}
                    className="mt-0.5"
                    checked={picked.includes(key)}
                    onCheckedChange={(on) =>
                      setPicked(on ? [...picked, key] : picked.filter((k) => k !== key))
                    }
                  />
                  <span className="grid gap-0.5">
                    <span className="text-body-sm font-medium">{title}</span>
                    <span className="text-caption text-muted-foreground">{hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border p-3 text-body-sm text-muted-foreground">
            {translate('workspaceAuditScopeFullHint')}
          </p>
        )}
        <p className="flex gap-2 rounded-lg bg-muted/60 p-3 text-caption text-muted-foreground">
          <Sparkles aria-hidden className="mt-px size-3.5 shrink-0 text-heidi" />
          {translate('workspaceAuditAllowance')}
        </p>
        {allowanceText && (
          <output className="text-body-sm text-muted-foreground">{allowanceText}</output>
        )}
        <DialogFooter>
          {hasReport && (
            <Button variant="outline" onClick={onShowReport}>
              {translate('workspaceAuditShowLast')}
            </Button>
          )}
          <Button
            disabled={!ready || checkingAllowance || !allowance || remaining === 0}
            onClick={() =>
              onStart(
                mode === 'full'
                  ? []
                  : auditScopes.flatMap(([k]) => (picked.includes(k) ? [k] : [])),
              )
            }
          >
            {translate('workspaceAuditStart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspaceAuditButton() {
  const ai = useAI('automation')
  const approval = useAIApproval()
  const billing = useBilling()
  const queryClient = useQueryClient()
  const lock = featureLock(billing.data, 'workspace_audit')
  const allowance = billing.data?.enabled
    ? usageItems(billing.data).find((item) => item.limit === 'workspace_audits_per_month')
    : billing.data && { used: 0, max: null }
  const [choosing, setChoosing] = useState(false)
  const [open, setOpen] = useState(false)
  const [areas, setAreas] = useState<AuditArea[]>([])
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [report, setReport] = useState<WorkspaceAudit | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const active = useRef<AbortController | null>(null)
  const runKey = useRef('')
  const paused = useRef(false)
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )
  async function run(scope: AuditArea[]) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    const signal = controller.signal
    paused.current = false
    setStopping(false)
    setRunning(true)
    setError('')
    setProgress(null)
    let started = false
    try {
      if (!(await approval.ensure()) || signal.aborted) return
      setOpen(true)
      const snapshot = await fetchAudit(signal, scope, runKey.current)
      if (signal.aborted) return
      setReport(snapshot)
      started = true
      const queue = snapshot.pending
      if (queue.length && ai.usedUp) {
        setError(translate('aiBudgetUsedUp'))
        return
      }
      // The automation budget admits one provider call per workspace at a time.
      async function inspectNext(index: number): Promise<void> {
        const id = queue[index]
        if (!id || paused.current || signal.aborted) return
        setProgress({ current: index + 1, total: queue.length })
        await inspectOriginal(id, signal, scope)
        if (signal.aborted) return
        if ((index + 1) % 10 === 0 && index + 1 < queue.length) {
          const latest = await fetchAudit(signal, scope, runKey.current)
          if (!signal.aborted) setReport(latest)
        }
        return inspectNext(index + 1)
      }
      await inspectNext(0)
      if (queue.length && !signal.aborted) {
        const latest = await fetchAudit(signal, scope, runKey.current)
        if (!signal.aborted) setReport(latest)
      }
    } catch (cause) {
      if (signal.aborted) return
      setOpen(true)
      setError(
        !started && cause instanceof ApiError && cause.code === 'limit_reached'
          ? translate('workspaceAuditLimitReached')
          : errorMessage(cause),
      )
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === 'forbidden' || cause.code === 'ai_consent_required')
      )
        setReport(null)
      else if (started) {
        try {
          const latest = await fetchAudit(signal, scope, runKey.current)
          if (!signal.aborted) setReport(latest)
        } catch {
          /* Keep the last snapshot and the original error. */
        }
      }
    } finally {
      void queryClient.invalidateQueries({ queryKey: billingKeys.overview })
      if (!signal.aborted) {
        active.current = null
        setRunning(false)
        setStopping(false)
        setProgress(null)
      }
    }
  }
  function start(scope: AuditArea[]) {
    runKey.current = crypto.randomUUID()
    setChoosing(false)
    setAreas(scope)
    setReport(null)
    void run(scope)
  }
  function chooseAgain() {
    setOpen(false)
    setChoosing(true)
    void billing.refetch()
  }
  function pause() {
    paused.current = true
    setStopping(true)
  }
  if (!ai.available || !billing.data) return null
  if (lock) {
    return (
      <Button asChild variant="outline">
        <Link href={PLANS_HREF}>
          <Sparkles aria-hidden className="text-heidi" />
          <span className="@max-2xl:sr-only">{translate('workspaceAuditAudit')}</span>
          <PlanTag lock={lock} />
        </Link>
      </Button>
    )
  }
  const status = stopping
    ? translate('workspaceAuditPausing')
    : progress
      ? translate('workspaceAuditProgress', progress)
      : translate('workspaceAuditChecking')
  const scopeLabel = areas.length
    ? new Intl.ListFormat(languageTag).format(
        auditScopes.flatMap(([k, title]) => (areas.includes(k) ? [title] : [])),
      )
    : translate('workspaceAuditScopeFull')
  return (
    <>
      <Button
        variant="outline"
        aria-label={running ? status : translate('workspaceAuditAudit')}
        onClick={() => (running ? setOpen(true) : chooseAgain())}
      >
        {running ? (
          <LoaderCircle aria-hidden className="animate-spin text-heidi" />
        ) : (
          <Sparkles aria-hidden className="text-heidi" />
        )}
        {running && progress ? (
          <span className="tabular-nums">
            <span className="@max-2xl:hidden">{translate('workspaceAuditRunning', progress)}</span>
            <span className="@2xl:hidden">
              {progress.current}/{progress.total}
            </span>
          </span>
        ) : (
          <span className="@max-2xl:hidden">
            {running ? translate('workspaceAuditRunningShort') : translate('workspaceAuditAudit')}
          </span>
        )}
      </Button>
      {choosing && (
        <ScopeDialog
          open
          onOpenChange={setChoosing}
          initial={areas}
          hasReport={!!report}
          allowance={allowance}
          checkingAllowance={billing.isFetching}
          onShowReport={() => {
            setChoosing(false)
            setOpen(true)
          }}
          onStart={start}
        />
      )}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false)
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full! max-w-none! flex-col gap-0 p-0 sm:w-[min(46rem,calc(100vw-3rem))]!"
        >
          <header className="shrink-0 border-b px-5 py-4 pr-12 md:px-7">
            <div className="flex items-center gap-2">
              <FileSearch aria-hidden className="size-5 text-heidi" />
              <SheetTitle>{translate('workspaceAuditAudit')}</SheetTitle>
            </div>
            <SheetDescription className="mt-1">
              {translate('workspaceAuditScopeOf', { scope: scopeLabel })}
            </SheetDescription>
          </header>
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 md:p-7">
            <output className="grid gap-1.5 text-body-sm text-muted-foreground">
              {running && (
                <span className="flex items-center gap-2 text-foreground">
                  <LoaderCircle aria-hidden className="size-4 animate-spin text-heidi" />
                  {status}
                </span>
              )}
              {running && progress && (
                <progress
                  className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-heidi [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-heidi"
                  max={progress.total}
                  value={progress.current}
                />
              )}
              {report && (
                <span className="text-caption">
                  {Object.entries(auditAreas)
                    .flatMap(([key, label]) => {
                      const count = Object.entries(report.counts).find(([k]) => k === key)?.[1]
                      return count === undefined
                        ? []
                        : [translate('workspaceAuditAreaCount', { area: label, count })]
                    })
                    .join(' · ')}
                  {report.counts.documents !== undefined && (
                    <>
                      <br />
                      {translate('workspaceAuditCoverage', {
                        read: report.read,
                        total: report.counts.documents,
                        partial: report.partial,
                      })}
                    </>
                  )}
                </span>
              )}
              {!running && !!report?.pending.length && (
                <span>{translate('workspaceAuditPending', { count: report.pending.length })}</span>
              )}
            </output>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 p-3 text-body-sm text-destructive"
              >
                {error}
              </p>
            )}
            {report && <Results report={report} running={running} />}
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t px-5 py-3">
            {running ? (
              <Button variant="outline" onClick={pause} disabled={stopping}>
                {translate('workspaceAuditPause')}
              </Button>
            ) : (
              <>
                <Button
                  variant={report?.pending.length ? 'outline' : 'default'}
                  onClick={chooseAgain}
                >
                  {translate('workspaceAuditNew')}
                </Button>
                {!!report?.pending.length && (
                  <Button onClick={() => void run(areas)}>
                    {translate('workspaceAuditResume')}
                  </Button>
                )}
              </>
            )}
          </footer>
        </SheetContent>
      </Sheet>
    </>
  )
}
