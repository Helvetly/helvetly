'use client'

import { Badge } from '@helvetly/ui/components/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@helvetly/ui/components/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
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
import { translate } from '@/lib/i18n'

import { EmployeeDocuments } from './employee-documents'
import { EmployeePay } from './employee-pay'
import { EmployeeStatusBadge } from './employee-status'
import { DisabledTip, useHrAccess, type HrAccess } from './hr-access'

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
        <SheetTitle className="sr-only">
          {employee ? fullName(employee) : translate('employeeTitle')}
        </SheetTitle>
        <SheetDescription className="sr-only">{translate('employeeRecord')}</SheetDescription>
        {employee ? (
          <Detail employee={employee} onClose={onClose} onEdit={() => onEdit(employee)} />
        ) : query.error ? (
          <div className="grid justify-items-center gap-3 px-6 py-20 text-center">
            <p className="text-title-sm">{translate('employeeLoadFailed')}</p>
            <p className="text-sm text-muted-foreground">
              {loadProblemText(query.error, translate('employeeThisEmployee'))}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {translate('employeeTryAgain')}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {translate('close')}
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
  const hr = useHrAccess()
  const [tab, setTab] = useState('employment')
  const [pending, setPending] = useState<Pending>(null)
  const [reason, setReason] = useState('')
  const archive = useArchiveEmployee()
  const erase = useEraseEmployee()
  const save = useSaveEmployee()
  const archived = employee.archived_at !== null
  const locked = employee.restricted || employee.erased_at !== null
  const hasMenu = hr.seesEmployeeWrites || hr.owner

  const tabs = [
    { value: 'employment', label: translate('employeeTabEmployment') },
    ...(hr.readPayroll ? [{ value: 'pay', label: translate('employeeTabPay') }] : []),
    { value: 'documents', label: translate('employeeTabDocuments') },
    { value: 'history', label: translate('employeeTabHistory') },
  ]

  const decide = (approved: boolean) => {
    const current = pending
    setPending(null)
    if (!approved) return
    if (current === 'erase')
      erase.mutate(employee.id, {
        onSuccess: (result) =>
          toast.success(
            translate('employeeErasedToast', {
              kept: result.kept_documents,
              deleted: result.deleted_documents,
            }),
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
            toast.success(
              translate(saved.legal_hold ? 'employeeHoldSetToast' : 'employeeHoldLiftedToast'),
            ),
          onError: (error) => toast.error(errorMessage(error)),
        },
      )
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-full gap-0">
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex h-12 items-center gap-1 border-b border-border/60 px-3">
          {employee.employee_number && (
            <Badge size="sm" className="font-code ml-1">
              {employee.employee_number}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            {hasMenu && hr.lockReason && (
              <DisabledTip reason={hr.lockReason}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('moreActions')}
                  disabled
                >
                  <Ellipsis />
                </Button>
              </DisabledTip>
            )}
            {hasMenu && !hr.lockReason && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={translate('moreActions')}>
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{translate('moreActions')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="min-w-52">
                  {hr.seesEmployeeWrites && (
                    <DropdownMenuItem
                      onSelect={() =>
                        archive.mutate(
                          { id: employee.id, archived: !archived },
                          {
                            onSuccess: () =>
                              toast.success(
                                translate(
                                  archived ? 'employeeRestoredToast' : 'employeeArchivedToast',
                                ),
                              ),
                            onError: (error) => toast.error(errorMessage(error)),
                          },
                        )
                      }
                    >
                      {archived ? <ArchiveRestore /> : <Archive />}
                      {translate(archived ? 'employeeRestore' : 'employeeArchive')}
                    </DropdownMenuItem>
                  )}
                  {hr.owner && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setReason('')
                        setPending('hold')
                      }}
                    >
                      {employee.legal_hold ? <LockOpen /> : <Lock />}
                      {translate(employee.legal_hold ? 'employeeLiftHold' : 'employeeSetHold')}
                    </DropdownMenuItem>
                  )}
                  {hr.owner && employee.erased_at === null && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setPending('erase')}>
                        <Eraser /> {translate('employeeErase')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {hr.seesEmployeeWrites && !locked && (
              <DisabledTip reason={hr.lockReason}>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={Boolean(hr.lockReason)}
                  onClick={onEdit}
                >
                  <Pencil className="size-3.5" /> {translate('employeeEdit')}
                </Button>
              </DisabledTip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('close')}
                  onClick={onClose}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('close')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="grid gap-1 px-6 pt-5 pb-3">
          <h2 className="text-page leading-tight font-medium tracking-[-0.02em] break-words">
            {fullName(employee)}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <EmployeeStatusBadge status={employee.status} />
            {employee.legal_hold && <Badge tone="amber">{translate('employeeLegalHold')}</Badge>}
            {employee.restricted && <Badge tone="red">{translate('employeeRestricted')}</Badge>}
            {employee.erased_at && <Badge>{translate('employeeErased')}</Badge>}
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
          <Callout tone="warning" icon={Lock} title={translate('employeeUnderHold')}>
            {employee.legal_hold_reason}
          </Callout>
        </div>
      )}

      <TabsContent value="employment" className="grid content-start gap-3 p-4 sm:p-5">
        <EmploymentTab employee={employee} hr={hr} />
      </TabsContent>
      {hr.readPayroll && (
        <TabsContent value="pay" className="grid content-start gap-3 p-4 sm:p-5">
          <EmployeePay employee={employee} />
        </TabsContent>
      )}
      <TabsContent value="documents" className="grid content-start gap-3 p-4 sm:p-5">
        <EmployeeDocuments employee={employee} />
      </TabsContent>
      <TabsContent value="history" className="grid content-start gap-3 p-4 sm:p-5">
        <HistoryTab id={employee.id} enabled={tab === 'history'} />
      </TabsContent>

      {pending === 'erase' && (
        <ConfirmDialog
          title={translate('employeeEraseTitle', { name: fullName(employee) })}
          body={translate('employeeEraseBody')}
          confirmLabel={translate('employeeErase')}
          confirmIcon={<Eraser />}
          tone="destructive"
          onDecide={decide}
        />
      )}
      {pending === 'hold' &&
        (employee.legal_hold ? (
          <ConfirmDialog
            title={translate('employeeLiftHoldTitle')}
            body={translate('employeeLiftHoldBody')}
            confirmLabel={translate('employeeLiftHold')}
            confirmIcon={<LockOpen />}
            tone="default"
            onDecide={decide}
          />
        ) : (
          <ConfirmDialog
            title={translate('employeeSetHoldTitle')}
            body={translate('employeeSetHoldBody')}
            confirmLabel={translate('employeeSetHold')}
            tone="default"
            onDecide={(approved) =>
              !approved || reason.trim()
                ? decide(approved)
                : toast.error(translate('employeeHoldReasonNeeded'))
            }
          >
            <label className="grid gap-1.5 text-body-sm font-medium">
              {translate('employeeHoldReason')}
              <textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={translate('employeeHoldReasonPlaceholder')}
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
const yesNo = (value: boolean) => translate(value ? 'employeeYes' : 'employeeNo')

function EmploymentTab({ employee, hr }: { employee: Employee; hr: HrAccess }) {
  const countries = useCountries().data
  const address = [
    [employee.street, employee.street_number].filter(Boolean).join(' '),
    employee.apt,
    [employee.postal_code, employee.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <>
      <Panel title={translate('employeePanelEmployment')}>
        <Row label={translate('employeeEmploymentType')}>
          {EMPLOYMENT_TYPES.find((type) => type.value === employee.employment_type)?.label}
        </Row>
        <Row label={translate('employeeRowDates')}>
          {employee.employment_end
            ? translate('employeeDatesRange', {
                start: formatDate(employee.employment_start),
                end: formatDate(employee.employment_end),
              })
            : translate('employeeDatesSince', { start: formatDate(employee.employment_start) })}
        </Row>
        <Row label={translate('employeeRowWorkingTime')}>
          {[
            employee.weekly_hours &&
              translate('employeeHoursPerWeek', { hours: employee.weekly_hours }),
            employee.working_time && `${employee.working_time} %`,
          ]
            .filter(Boolean)
            .join(' · ') || null}
        </Row>
        <Row label={translate('employeeNoticePeriod')}>{employee.notice_period}</Row>
        <Row label={translate('employeeThirteenth')}>{yesNo(employee.thirteenth_salary)}</Row>
        <Row label={translate('employeeEmployingEntity')}>{employee.employing_entity}</Row>
        <Row label={translate('employeeMemberLink')}>
          <span className="inline-flex items-center gap-1.5">
            {employee.member_name ? (
              <>
                {employee.member_name}
                {!employee.member_active && <Badge>{translate('employeeNoLongerMember')}</Badge>}
              </>
            ) : (
              <span className="text-muted-foreground">{translate('employeeNotLinked')}</span>
            )}
            <HelpTip label={translate('employeeMemberLinkLabel')}>
              {translate('employeeMemberLinkTip')}
            </HelpTip>
          </span>
        </Row>
      </Panel>

      <Panel title={translate('employeePanelContact')}>
        <Row label={translate('employeeEmail')}>{employee.email}</Row>
        <Row label={translate('employeePhone')}>{employee.phone}</Row>
        <Row label={translate('employeeRowAddress')}>
          {address || employee.address_country
            ? [address, country(employee.address_country)].filter(Boolean).join(', ')
            : null}
        </Row>
      </Panel>

      <Panel title={translate('employeeSectionWork')}>
        <Row label={translate('employeeRowWork')}>
          {placeLabel(countries, employee.work_country, employee.work_region)}
          {employee.work_locality && ` (${employee.work_locality})`}
        </Row>
        <Row label={translate('employeePlaceOfWork')}>{employee.place_of_work}</Row>
        <Row label={translate('employeeEmployerCountry')}>{country(employee.employer_country)}</Row>
        <Row label={translate('employeeRowResidence')}>{country(employee.residence_country)}</Row>
        <Row label={translate('employeeRowSocialSecurity')}>
          {country(employee.social_security_country)}
        </Row>
        <Row label={translate('employeeRowCrossBorder')}>
          {employee.cross_border
            ? (employee.cross_border_note ?? translate('employeeYes'))
            : translate('employeeNo')}
        </Row>
      </Panel>

      {employee.work_country === 'CH' && <SwissPanel employee={employee} />}

      <JurisdictionPanel id={employee.id} />

      {hr.readPayroll && <ProtectedPanel employee={employee} canReveal={hr.reveal} />}
    </>
  )
}

function SwissPanel({ employee }: { employee: Employee }) {
  const countries = useCountries().data
  return (
    <Panel
      title={translate('employeeSectionSwiss')}
      action={
        <HelpTip label={translate('employeeSectionSwiss')}>
          {translate('employeeSectionSwissTip')}
        </HelpTip>
      }
    >
      <Row label={translate('employeeRowWithholding')}>
        {employee.withholding_tax
          ? (countries
              ?.find((entry) => entry.code === 'CH')
              ?.regions?.find((region) => region.code === employee.withholding_tax_canton)?.name ??
            employee.withholding_tax_canton ??
            translate('employeeYes'))
          : translate('employeeNo')}
      </Row>
      <Row label={translate('employeePensionInsurer')}>{employee.pension_insurer}</Row>
      <Row label={translate('employeeAccidentInsurer')}>{employee.accident_insurer}</Row>
      <Row label={translate('employeeSicknessInsurer')}>{employee.sickness_insurer}</Row>
      <Row label={translate('employeeRowCertificate')}>
        {[
          employee.free_transport && translate('employeeFreeTransport'),
          employee.canteen_meals && translate('employeeCanteenMeals'),
        ]
          .filter(Boolean)
          .join(' · ') || null}
      </Row>
    </Panel>
  )
}

const RESOLUTION = {
  register_only: { tone: 'blue', label: translate('employeeResolutionRegister') },
  ambiguous: { tone: 'amber', label: translate('employeeResolutionAmbiguous') },
  unsupported: { tone: 'neutral', label: translate('employeeResolutionUnsupported') },
} as const

function JurisdictionPanel({ id }: { id: string }) {
  const query = useJurisdiction(id)
  const resolution = query.data
  return (
    <Panel
      title={translate('employeeRulesTitle')}
      action={
        <HelpTip label={translate('employeeRulesLabel')}>{translate('employeeRulesTip')}</HelpTip>
      }
    >
      {resolution ? (
        <div className="grid gap-3 text-body">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RESOLUTION[resolution.status].tone}>
              {RESOLUTION[resolution.status].label}
            </Badge>
            <span className="text-muted-foreground">
              {resolution.country_name || resolution.jurisdiction}
            </span>
          </div>
          <p className="text-body-sm">{translate('employeeRegisterMode')}</p>
          {resolution.reasons.length > 0 && (
            <ul className="grid list-disc gap-1 pl-5 text-body-sm text-muted-foreground">
              {resolution.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {resolution.blocked.length > 0 && (
            <div className="grid gap-1">
              <p className="text-body-sm font-medium text-muted-foreground">
                {translate('employeeNotAutomated')}
              </p>
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
          {loadProblemText(query.error, translate('employeeTheRules'))}
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
  const stored = Boolean(
    employee.bank_account_hint || employee.tax_id_hint || employee.social_security_number_hint,
  )
  return (
    <Panel
      title={translate('employeeSectionProtected')}
      action={
        <span className="flex items-center gap-1">
          {canReveal &&
            stored &&
            (shown ? (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => reveal.reset()}>
                <EyeOff className="size-3.5" /> {translate('employeeHide')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={reveal.isPending}
                onClick={() =>
                  reveal.mutate(undefined, {
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
              >
                <Eye className="size-3.5" /> {translate('employeeReveal')}
              </Button>
            ))}
          <HelpTip label={translate('employeeSectionProtected')}>
            {translate('employeeSectionProtectedTip')}
          </HelpTip>
        </span>
      }
    >
      <Row label={translate('employeeRowBankAccount')}>
        <span className="font-code text-body-sm">
          {shown ? shown.bank_account : hint(employee.bank_account_hint)}
        </span>
      </Row>
      <Row label={translate('employeeTaxId')}>
        <span className="font-code text-body-sm">
          {shown ? shown.tax_id : hint(employee.tax_id_hint)}
        </span>
      </Row>
      <Row label={translate('employeeSocialSecurityNumber')}>
        <span className="font-code text-body-sm">
          {shown ? shown.social_security_number : hint(employee.social_security_number_hint)}
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
        {loadProblemText(query.error, translate('employeeTheHistory'))}
      </p>
    )
  if (!query.data) return <Loader className="h-24" />
  if (query.data.length === 0)
    return <p className="text-body-sm text-muted-foreground">{translate('employeeNoHistory')}</p>
  return (
    <Panel title={translate('employeeTabHistory')}>
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
