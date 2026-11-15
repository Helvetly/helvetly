'use client'

import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { Loader } from '@helvetly/ui/components/loader'
import { Panel } from '@helvetly/ui/components/panel'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@helvetly/ui/components/sheet'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { countryName } from '@helvetly/ui/lib/countries'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Pencil,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { inputClass } from '@/components/clients/fields'
import { loadProblemText } from '@/components/data/load-problem'
import { errorMessage } from '@/lib/api'
import {
  EMPLOYMENT_TYPES,
  fullName,
  historyLabel,
  placeLabel,
  useArchiveEmployee,
  useCountries,
  useEmployee,
  useEmployeeHistory,
  useEraseEmployee,
  useJurisdiction,
  useRevealProtected,
  useSaveEmployee,
  type Employee,
} from '@/lib/employees'
import { useCan } from '@/lib/permissions'
import { useSession } from '@/lib/queries'

import { EmployeeDocuments } from './employee-documents'
import { EmployeePay } from './employee-pay'
import { EmployeeStatusBadge } from './employee-status'

/** One employee, in a sheet from the right (full screen on phones). */
export function EmployeeDetail({
  id,
  onClose,
  onEdit,
}: {
  id: string
  onClose: () => void
  onEdit: (employee: Employee) => void
}) {
  const query = useEmployee(id)
  const employee = query.data
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full! max-w-none! gap-0 overflow-y-auto bg-panel p-0 sm:w-[min(760px,100vw)]! dark:bg-background"
      >
        <SheetTitle className="sr-only">{employee ? fullName(employee) : 'Employee'}</SheetTitle>
        <SheetDescription className="sr-only">Employee record</SheetDescription>
        {employee ? (
          <Detail employee={employee} onClose={onClose} onEdit={() => onEdit(employee)} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-title-sm">This employee couldn’t be loaded.</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, 'This employee')}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <Loader className="flex-1" />
        )}
      </SheetContent>
    </Sheet>
  )
}

type Pending = 'erase' | 'hold' | null

function Detail({
  employee,
  onClose,
  onEdit,
}: {
  employee: Employee
  onClose: () => void
  onEdit: () => void
}) {
  const owner = useSession().data?.role === 'owner'
  const canWrite = useCan('write:employees')
  const canPay = useCan('read:payroll')
  const canDocuments = useCan('read:employee-documents')
  const [tab, setTab] = useState('employment')
  const [pending, setPending] = useState<Pending>(null)
  const [reason, setReason] = useState('')
  const archive = useArchiveEmployee()
  const erase = useEraseEmployee()
  const save = useSaveEmployee()
  const archived = employee.archived_at !== null
  const locked = employee.restricted || employee.erased_at !== null

  const tabs = [
    { value: 'employment', label: 'Employment' },
    ...(canPay ? [{ value: 'pay', label: 'Pay' }] : []),
    ...(canDocuments ? [{ value: 'documents', label: 'Documents' }] : []),
    { value: 'history', label: 'History' },
  ]

  const decide = (approved: boolean) => {
    const current = pending
    setPending(null)
    if (!approved) return
    if (current === 'erase')
      erase.mutate(employee.id, {
        onSuccess: (result) =>
          toast.success(
            `Personal data erased. ${result.kept_documents} document(s) kept, ${result.deleted_documents} deleted.`,
          ),
        onError: (error) => toast.error(errorMessage(error)),
      })
    if (current === 'hold')
      save.mutate(
        {
          id: employee.id,
          input: employee.legal_hold
            ? { legal_hold: false }
            : { legal_hold: true, legal_hold_reason: reason.trim() || null },
        },
        {
          onSuccess: (saved) =>
            toast.success(saved.legal_hold ? 'Legal hold set.' : 'Legal hold lifted.'),
          onError: (error) => toast.error(errorMessage(error)),
        },
      )
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-full gap-0">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          {employee.employee_number && (
            <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
              {employee.employee_number}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {(canWrite || owner) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More actions">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {canWrite && (
                    <DropdownMenuItem
                      onSelect={() =>
                        archive.mutate(
                          { id: employee.id, archived: !archived },
                          {
                            onSuccess: () => toast.success(archived ? 'Restored.' : 'Archived.'),
                            onError: (error) => toast.error(errorMessage(error)),
                          },
                        )
                      }
                    >
                      {archived ? <ArchiveRestore /> : <Archive />}
                      {archived ? 'Restore from archive' : 'Archive'}
                    </DropdownMenuItem>
                  )}
                  {owner && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setReason('')
                        setPending('hold')
                      }}
                    >
                      {employee.legal_hold ? <LockOpen /> : <Lock />}
                      {employee.legal_hold ? 'Lift legal hold' : 'Set legal hold'}
                    </DropdownMenuItem>
                  )}
                  {canWrite && employee.erased_at === null && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setPending('erase')}>
                        <Eraser /> Erase personal data
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canWrite && !locked && (
              <Button variant="outline" className="gap-1.5" onClick={onEdit}>
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
        </div>
        <div className="grid gap-1 px-6 pt-5 pb-3">
          <h2 className="text-page leading-tight font-medium tracking-[-0.02em] break-words">
            {fullName(employee)}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <EmployeeStatusBadge status={employee.status} />
            {employee.legal_hold && <StatusBadge tone="amber">Legal hold</StatusBadge>}
            {employee.restricted && <StatusBadge tone="red">Restricted</StatusBadge>}
            {employee.erased_at && <StatusBadge>Erased</StatusBadge>}
            <span className="text-body-sm text-muted-foreground">
              {[employee.position, employee.department].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>
        <div className="border-b border-border/60 px-4 sm:px-6">
          {/* Scrolls sideways on phones; the padding gives the focus rings room inside the scroller. */}
          <div className="-mx-4 -my-1 [scrollbar-width:none] overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6">
            <TabsList variant="line" className="-mb-px h-10 gap-4 p-0">
              {tabs.map((entry) => (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  className="h-full flex-none px-0 text-body font-normal after:bottom-0! after:h-[2px] after:bg-primary"
                >
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
      </header>

      {employee.legal_hold && employee.legal_hold_reason && (
        <div className="px-4 pt-4 sm:px-5">
          <Callout tone="warning" icon={Lock} title="Under a legal hold">
            {employee.legal_hold_reason}
          </Callout>
        </div>
      )}

      <TabsContent value="employment" className="grid content-start gap-3 p-4 sm:p-5">
        <EmploymentTab employee={employee} canReveal={canPay} />
      </TabsContent>
      {canPay && (
        <TabsContent value="pay" className="grid content-start gap-3 p-4 sm:p-5">
          <EmployeePay employee={employee} />
        </TabsContent>
      )}
      {canDocuments && (
        <TabsContent value="documents" className="grid content-start gap-3 p-4 sm:p-5">
          <EmployeeDocuments employee={employee} owner={owner} />
        </TabsContent>
      )}
      <TabsContent value="history" className="grid content-start gap-3 p-4 sm:p-5">
        <HistoryTab id={employee.id} enabled={tab === 'history'} />
      </TabsContent>

      {pending === 'erase' && (
        <ConfirmDialog
          title={`Erase ${fullName(employee)}’s personal data?`}
          body="Contact details, bank account, tax ID and the member link are removed, and documents past their retention date are deleted. What a retention duty or a legal hold covers is kept (pay terms, payroll and those documents), with only the name and employment dates; the record then stays read-only. This can’t be undone."
          confirmLabel="Erase personal data"
          confirmIcon={<Eraser />}
          tone="destructive"
          onDecide={decide}
        />
      )}
      {pending === 'hold' &&
        (employee.legal_hold ? (
          <ConfirmDialog
            title="Lift the legal hold?"
            body="Retention rules apply again: documents past their date can then be deleted."
            confirmLabel="Lift legal hold"
            confirmIcon={<LockOpen />}
            tone="default"
            onDecide={decide}
          />
        ) : (
          <ConfirmDialog
            title="Set a legal hold?"
            body="Nothing of this employee can be deleted or erased while the hold is on, whatever the retention rules say."
            confirmLabel="Set legal hold"
            tone="default"
            onDecide={(approved) =>
              !approved || reason.trim()
                ? decide(approved)
                : toast.error('Say why the data must be kept.')
            }
          >
            <label className="grid gap-1.5 text-body-sm font-medium">
              Reason
              <textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="E.g. a dispute or an authority’s request"
                className={cn(inputClass, 'h-auto min-h-16 resize-y py-2 font-normal')}
              />
            </label>
          </ConfirmDialog>
        ))}
    </Tabs>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-start gap-3 border-t border-border/60 py-2 first:border-t-0">
      <span className="w-40 shrink-0 text-body-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-body break-words">
        {children ?? <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  )
}

const country = (code: string | null) => (code ? countryName(code) : null)

function EmploymentTab({ employee, canReveal }: { employee: Employee; canReveal: boolean }) {
  const countries = useCountries().data
  const address = [employee.street, [employee.postal_code, employee.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return (
    <>
      <Panel title="Employment">
        <Row label="Employment type">
          {EMPLOYMENT_TYPES.find((type) => type.value === employee.employment_type)?.label}
        </Row>
        <Row label="Start">{formatDate(employee.employment_start)}</Row>
        <Row label="End">{employee.employment_end && formatDate(employee.employment_end)}</Row>
        <Row label="Working time">{employee.working_time && `${employee.working_time} %`}</Row>
        <Row label="Employing company">{employee.employing_entity}</Row>
        <Row label="Member link">
          <span className="inline-flex items-center gap-1.5">
            {employee.member_name ? (
              <>
                {employee.member_name}
                {!employee.member_active && <StatusBadge>No longer a member</StatusBadge>}
              </>
            ) : (
              <span className="text-muted-foreground">Not linked</span>
            )}
            <HelpTip label="About the member link">
              A link to a member only says who this is in Helvetly. It grants nothing: access comes
              from the member’s own role and permissions.
            </HelpTip>
          </span>
        </Row>
      </Panel>

      <Panel title="Contact">
        <Row label="Email">{employee.email}</Row>
        <Row label="Phone">{employee.phone}</Row>
        <Row label="Address">
          {address || employee.address_country
            ? [address, country(employee.address_country)].filter(Boolean).join(', ')
            : null}
        </Row>
      </Panel>

      <Panel title="Place of work">
        <Row label="Work">
          {placeLabel(countries, employee.work_country, employee.work_region)}
          {employee.work_locality && ` (${employee.work_locality})`}
        </Row>
        <Row label="Place of work">{employee.place_of_work}</Row>
        <Row label="Employer country">{country(employee.employer_country)}</Row>
        <Row label="Residence">{country(employee.residence_country)}</Row>
        <Row label="Social security">{country(employee.social_security_country)}</Row>
        <Row label="Cross-border">
          {employee.cross_border ? (employee.cross_border_note ?? 'Yes') : 'No'}
        </Row>
      </Panel>

      <JurisdictionPanel id={employee.id} />

      <ProtectedPanel employee={employee} canReveal={canReveal} />
    </>
  )
}

const RESOLUTION = {
  register_only: { tone: 'blue', label: 'Register mode' },
  ambiguous: { tone: 'amber', label: 'Needs a closer look' },
  unsupported: { tone: 'gray', label: 'Not modelled' },
} as const

function JurisdictionPanel({ id }: { id: string }) {
  const query = useJurisdiction(id)
  const resolution = query.data
  return (
    <Panel
      title="Rules that apply"
      action={
        <HelpTip label="About the rules">
          Helvetly looks at where the employee works to suggest retention dates. It does not
          calculate pay, taxes or contributions and does not check that you meet your obligations.
        </HelpTip>
      }
    >
      {resolution ? (
        <div className="grid gap-3 text-body">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={RESOLUTION[resolution.status].tone}>
              {RESOLUTION[resolution.status].label}
            </StatusBadge>
            <span className="text-muted-foreground">
              {resolution.country_name || resolution.jurisdiction}
            </span>
          </div>
          <p className="text-body-sm">Register mode: pay is recorded, not calculated.</p>
          {resolution.reasons.length > 0 && (
            <ul className="grid list-disc gap-1 pl-5 text-body-sm text-muted-foreground">
              {resolution.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {resolution.blocked.length > 0 && (
            <div className="grid gap-1">
              <p className="text-body-sm font-medium text-muted-foreground">Not automated</p>
              <ul className="grid gap-1 text-body-sm">
                {resolution.blocked.map((block) => (
                  <li key={block.feature}>{block.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : query.error ? (
        <p className="text-body-sm text-muted-foreground">
          {loadProblemText(query.error, 'The rules')}
        </p>
      ) : (
        <Loader className="h-16" />
      )}
    </Panel>
  )
}

const hint = (value: string | null) => (value ? `•••• ${value}` : null)

function ProtectedPanel({ employee, canReveal }: { employee: Employee; canReveal: boolean }) {
  // A mutation, not a query: the revealed values live in this panel's state and go when it closes.
  const reveal = useRevealProtected(employee.id)
  const shown = reveal.data
  return (
    <Panel
      title="Protected"
      action={
        canReveal &&
        (employee.bank_account_hint || employee.tax_id_hint) &&
        (shown ? (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => reveal.reset()}>
            <EyeOff className="size-3.5" /> Hide
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={reveal.isPending}
            onClick={() =>
              reveal.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })
            }
          >
            <Eye className="size-3.5" /> Reveal
          </Button>
        ))
      }
    >
      <Row label="Bank account">
        <span className="font-mono text-body-sm">
          {shown ? shown.bank_account : hint(employee.bank_account_hint)}
        </span>
      </Row>
      <Row label="Tax ID">
        <span className="font-mono text-body-sm">
          {shown ? shown.tax_id : hint(employee.tax_id_hint)}
        </span>
      </Row>
    </Panel>
  )
}

function HistoryTab({ id, enabled }: { id: string; enabled: boolean }) {
  const query = useEmployeeHistory(id, enabled)
  if (query.error)
    return (
      <p className="text-body-sm text-muted-foreground">
        {loadProblemText(query.error, 'The history')}
      </p>
    )
  if (!query.data) return <Loader className="h-24" />
  if (query.data.length === 0)
    return <p className="text-body-sm text-muted-foreground">Nothing recorded yet.</p>
  return (
    <Panel title="History">
      <ol className="grid">
        {query.data.map((event) => (
          <li
            key={`${event.kind}-${event.subject_id}-${event.at}`}
            className="flex items-baseline justify-between gap-3 border-t border-border/60 py-2 text-body first:border-t-0"
          >
            <span>
              {historyLabel(event.kind)}
              {event.actor && <span className="text-muted-foreground"> · {event.actor}</span>}
            </span>
            <time dateTime={event.at} className="shrink-0 text-body-sm text-muted-foreground">
              {formatDate(event.at)}
            </time>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
