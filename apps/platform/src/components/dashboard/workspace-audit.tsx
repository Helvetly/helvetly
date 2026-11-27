'use client'

import { Badge, type Tone } from '@helvetly/ui/components/badge'
import { Button } from '@helvetly/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@helvetly/ui/components/sheet'
import { CheckCheck, ChevronRight, FileSearch, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAIApproval } from '@/components/ai/ai-approval'
import { NativeSelect } from '@/components/clients/fields'
import { RecordLink } from '@/components/record-link'
import { useAI } from '@/lib/ai'
import { ApiError, errorMessage } from '@/lib/api'
import { translate } from '@/lib/i18n'
import {
  auditAreas,
  auditClasses,
  auditLevels,
  evidenceHref,
  fetchAudit,
  findingCopy,
  findingGroups,
  findingValues,
  inspectOriginal,
  type AuditFinding,
  type WorkspaceAudit,
} from '@/lib/workspace-audit'

const tones: Record<keyof typeof auditLevels, Tone> = {
  critical: 'red',
  high: 'amber',
  medium: 'blue',
  low: 'neutral',
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
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-body-sm">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground group-open:rotate-90"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-muted-foreground">
            {auditAreas[first.category]} · {auditClasses[first.class]}
          </span>
          <strong>{title}</strong>{' '}
          <span className="text-muted-foreground tabular-nums">({items.length})</span>
        </span>
        <Badge tone={tones[first.severity]} size="sm">
          {auditLevels[first.severity]}
        </Badge>
      </summary>
      {open && (
        <div className="border-t px-4 pb-3 text-body-sm">
          {advice && first.code !== 'source_observation' && (
            <p className="pt-3 text-muted-foreground">{advice}</p>
          )}
          <ol className="divide-y">
            {items.slice(0, limit).map((item) => (
              <li key={item.id} className="grid gap-1.5 py-3">
                {item.values?.length ? (
                  <p className="font-medium break-words">{findingValues(item)}</p>
                ) : null}
                {item.advice && <p className="break-words text-muted-foreground">{item.advice}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {item.evidence.map((e) => (
                    <RecordLink
                      className="break-all text-primary underline"
                      href={evidenceHref(e)}
                      key={e.kind + e.id}
                    >
                      {e.label || e.id}
                    </RecordLink>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {items.length > limit && (
            <Button size="sm" variant="outline" onClick={() => setLimit(limit + 30)}>
              {translate('workspaceAuditMore')}
            </Button>
          )}
        </div>
      )}
    </details>
  )
}
function Results({ report }: { report: WorkspaceAudit }) {
  const [area, setArea] = useState('')
  const [level, setLevel] = useState('')
  const groups = useMemo(
    () => findingGroups(report.findings, area, level),
    [report.findings, area, level],
  )
  return (
    <>
      <div className="grid gap-1">
        <h3 className="text-title-sm font-semibold">
          {translate('workspaceAuditSummary', { count: report.findings.length })}
        </h3>
        <p className="text-caption text-muted-foreground">
          {translate('workspaceAuditChecked')} ·{' '}
          {Object.entries(auditAreas)
            .flatMap(([key, label]) => {
              const count = Object.entries(report.counts).find(([k]) => k === key)?.[1]
              return count === undefined ? [] : [label + ' ' + count]
            })
            .join(' · ')}
        </p>
      </div>
      {report.findings.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect
              aria-label={translate('workspaceAuditAreas')}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">{translate('workspaceAuditAllAreas')}</option>
              {Object.entries(auditAreas).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={translate('workspaceAuditSeverity')}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">{translate('workspaceAuditAllLevels')}</option>
              {Object.entries(auditLevels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
          {groups.length ? (
            groups.map(([key, items]) => <Group key={key} items={items} />)
          ) : (
            <p>{translate('workspaceAuditNoMatch')}</p>
          )}
        </>
      ) : (
        <p className="flex items-center gap-2 text-body-sm">
          <CheckCheck aria-hidden className="size-4" />
          {translate('workspaceAuditClear')}
        </p>
      )}
    </>
  )
}

export function WorkspaceAuditButton() {
  const ai = useAI('automation')
  const approval = useAIApproval()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [report, setReport] = useState<WorkspaceAudit | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const active = useRef<AbortController | null>(null)
  const paused = useRef(false)
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )
  async function run() {
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
      const snapshot = await fetchAudit(signal)
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
        await inspectOriginal(id, signal)
        if (signal.aborted) return
        if ((index + 1) % 10 === 0 && index + 1 < queue.length) {
          const latest = await fetchAudit(signal)
          if (!signal.aborted) setReport(latest)
        }
        return inspectNext(index + 1)
      }
      await inspectNext(0)
      if (queue.length && !signal.aborted) {
        const latest = await fetchAudit(signal)
        if (!signal.aborted) setReport(latest)
      }
    } catch (cause) {
      if (signal.aborted) return
      setOpen(true)
      setError(errorMessage(cause))
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === 'forbidden' || cause.code === 'ai_consent_required')
      )
        setReport(null)
      else if (started) {
        try {
          const latest = await fetchAudit(signal)
          if (!signal.aborted) setReport(latest)
        } catch {
          /* Keep the last snapshot and the original error. */
        }
      }
    } finally {
      if (!signal.aborted) {
        active.current = null
        setRunning(false)
        setStopping(false)
        setProgress(null)
      }
    }
  }
  function pause() {
    paused.current = true
    setStopping(true)
  }
  if (!ai.available) return null
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (running) pause()
          setOpen(false)
        } else if (report || error || running) setOpen(true)
        else void run()
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" aria-label={translate('workspaceAuditAudit')}>
          <Sparkles aria-hidden className="text-heidi" />
          <span className="hidden sm:inline">{translate('workspaceAuditAudit')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full! max-w-none! flex-col gap-0 p-0 sm:w-[min(46rem,calc(100vw-3rem))]!"
      >
        <header className="shrink-0 border-b px-5 py-5 pr-12 md:px-7">
          <div className="flex items-center gap-2">
            <FileSearch aria-hidden className="size-5 text-heidi" />
            <SheetTitle>{translate('workspaceAuditAudit')}</SheetTitle>
          </div>
          <SheetDescription className="mt-1">
            {translate('workspaceAuditDescription')}
          </SheetDescription>
        </header>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-5 md:p-7">
          <output className="grid gap-1 text-body-sm text-muted-foreground">
            {running && (
              <span className="flex items-center gap-2">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                {stopping
                  ? translate('workspaceAuditPausing')
                  : progress
                    ? translate('workspaceAuditProgress', progress)
                    : translate('workspaceAuditChecking')}
              </span>
            )}
            {report?.counts.documents !== undefined && (
              <span>
                {translate('workspaceAuditCoverage', {
                  read: report.read,
                  total: report.counts.documents,
                  partial: report.partial,
                })}
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
          {report && <Results report={report} />}
        </div>
        <footer className="flex shrink-0 justify-end border-t px-5 py-3">
          {running ? (
            <Button variant="outline" onClick={pause} disabled={stopping}>
              {translate('workspaceAuditPause')}
            </Button>
          ) : (
            <Button onClick={() => void run()}>
              {report?.pending.length
                ? translate('workspaceAuditResume')
                : translate('workspaceAuditRefresh')}
            </Button>
          )}
        </footer>
      </SheetContent>
    </Sheet>
  )
}
