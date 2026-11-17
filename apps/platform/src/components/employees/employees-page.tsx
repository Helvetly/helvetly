'use client'

import { Button } from '@helvetly/ui/components/button'
import { DropdownMenuItem } from '@helvetly/ui/components/dropdown-menu'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Download,
  IdCard,
  Lock,
  ScrollText,
  Search,
  SearchX,
  Settings,
  UserPlus,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { NativeSelect } from '@/components/clients/fields'
import { listTable } from '@/components/data/list-table'
import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { PageHeader } from '@/components/shell/page-header'
import {
  fullName,
  listParamsToQuery,
  parseListParams,
  STATUSES,
  useEmployee,
  useEmployeeList,
  useEmploymentSettings,
  type Employee,
  type ListParams,
} from '@/lib/employees'
import { translate } from '@/lib/i18n'
import { setUrlQuery } from '@/lib/url-query'

import { EmployeeDetail } from './employee-detail'
import { EmployeeForm } from './employee-form'
import { EmployeeStatusBadge } from './employee-status'
import { HrLockNotice, useHrAccess, useHrTabs } from './hr-access'
import { RetentionReview } from './retention-review'

/** Employees: the company's staff, apart from the members who use Helvetly. */
export function EmployeesPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const hr = useHrAccess()
  const tabs = useHrTabs('employees')
  const list = useEmployeeList(params, !hr.blocked)
  // Payroll alone lists employees by name but cannot open their records.
  const canOpen = hr.readEmployees
  const openId = canOpen ? query.get('id') : null
  const editId = hr.writeEmployees ? query.get('edit') : null
  const creating = query.get('new') === '1' && hr.writeEmployees
  const reviewing = query.get('retention') === '1' && hr.owner
  const [search, setSearch] = useState(params.search)

  const go = (change: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(change))
      if (value === null) next.delete(key)
      else next.set(key, value)
    setUrlQuery(pathname, next, push)
  }
  const setParams = (change: Partial<ListParams>) =>
    setUrlQuery(pathname, listParamsToQuery({ ...params, ...change }, query))

  // Typing waits a moment before it narrows the list (and the URL).
  useEffect(() => {
    if (search === params.search) return
    const timer = setTimeout(() => setParams({ search }), 250)
    return () => clearTimeout(timer)
  })

  const rows = list.data?.data ?? []
  const departments = list.data?.departments ?? []
  const filtered = params.search !== '' || params.status !== 'active' || params.department !== null
  // An empty list has one first action, in the empty state; the header's comes back with the first employee.
  const empty = list.data !== undefined && rows.length === 0 && !filtered
  const create = () => go({ new: '1' }, true)

  return (
    <>
      <PageHeader
        {...tabs}
        primary={hr.writeEmployees && !empty ? translate('employeeNew') : undefined}
        onPrimary={create}
        menu={
          (hr.owner || hr.readEmployees) && (
            <>
              <DropdownMenuItem asChild>
                <Link href="/settings/employment">
                  <Settings /> {translate('employeeSettingsLink')}
                </Link>
              </DropdownMenuItem>
              {hr.owner && (
                <>
                  <DropdownMenuItem onSelect={() => go({ retention: '1' }, true)}>
                    <ScrollText /> {translate('employeeRetentionTitle')}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings/workspace#export-workspace">
                      <Download /> {translate('employeeExportLink')}
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </>
          )
        }
      />
      <HrLockNotice hr={hr} />
      {hr.blocked ? (
        <State
          icon={<Lock />}
          title={translate('employeeLockedTitle')}
          text={translate('employeeLockedText')}
          action={null}
        />
      ) : (
        <div className="flex flex-1 flex-col">
          {/* On a phone the search has its own row and the two filters share the next. */}
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5">
            <label className="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground max-sm:basis-full">
              <Search className="size-4 shrink-0 stroke-[1.5]" />
              <input
                type="search"
                aria-label={translate('employeeSearchLabel')}
                placeholder={translate('employeeSearchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent text-title-sm text-foreground outline-none placeholder:text-placeholder"
              />
            </label>
            <NativeSelect
              aria-label={translate('employeeStatusLabel')}
              wrapperClassName="w-36 max-sm:w-auto max-sm:flex-1"
              className="h-8"
              value={params.status}
              onChange={(event) =>
                setParams({
                  status:
                    STATUSES.find((status) => status.value === event.target.value)?.value ??
                    'active',
                })
              }
            >
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={translate('employeeDepartment')}
              wrapperClassName="w-44 max-sm:w-auto max-sm:flex-1"
              className="h-8"
              disabled={departments.length === 0}
              value={params.department ?? ''}
              onChange={(event) => setParams({ department: event.target.value || null })}
            >
              <option value="">{translate('employeeAllDepartments')}</option>
              {departments.map((department) => (
                <option key={department}>{department}</option>
              ))}
            </NativeSelect>
            <HelpTip label={translate('employeeAndMembersLabel')}>
              {translate('employeeAndMembersTip')}
            </HelpTip>
          </div>

          {list.error ? (
            <LoadProblem
              error={list.error}
              what={translate('employeeTheEmployees')}
              onRetry={() => void list.refetch()}
            />
          ) : !list.data ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            filtered ? (
              <State
                icon={<SearchX />}
                title={translate('employeeNobodyMatches')}
                text={translate('employeeNobodyMatchesText')}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setParams({ search: '', status: 'active', department: null })
                    }}
                  >
                    {translate('employeeClearFilters')}
                  </Button>
                }
              />
            ) : (
              <State
                icon={<IdCard />}
                title={translate('employeeEmptyTitle')}
                text={translate('employeeEmptyText')}
                action={
                  hr.writeEmployees ? (
                    <Button size="sm" className="gap-1.5" onClick={create}>
                      <UserPlus className="size-3.5" /> {translate('employeeNew')}
                    </Button>
                  ) : null
                }
              />
            )
          ) : (
            <EmployeeRows rows={rows} onOpen={canOpen ? (id) => go({ id }, true) : undefined} />
          )}
        </div>
      )}

      {openId && !editId && (
        <EmployeeDetail
          id={openId}
          onClose={() => go({ id: null })}
          onEdit={(employee) => go({ edit: employee.id }, true)}
        />
      )}
      {editId && <EditEmployee id={editId} onClose={() => go({ edit: null })} />}
      {creating && (
        <NewEmployee
          onClose={() => go({ new: null })}
          onSaved={(employee) => go({ new: null, id: employee.id })}
        />
      )}
      {reviewing && (
        <RetentionReview
          onClose={() => go({ retention: null })}
          onOpen={(id) => go({ retention: null, id }, true)}
        />
      )}
    </>
  )
}

function EmployeeRows({ rows, onOpen }: { rows: Employee[]; onOpen?: (id: string) => void }) {
  return (
    <>
      <table className={cn(listTable.table, 'hidden lg:table')}>
        <thead>
          <tr className={listTable.head}>
            <th className={cn(listTable.th, 'w-[30%]')}>{translate('employeeColName')}</th>
            <th className={cn(listTable.th, 'w-[22%]')}>{translate('employeePosition')}</th>
            <th className={cn(listTable.th, 'w-[16%]')}>{translate('employeeDepartment')}</th>
            <th className={cn(listTable.th, 'w-[16%]')}>{translate('employeeColSince')}</th>
            <th className={cn(listTable.th, 'w-[16%]')}>{translate('employeeStatusLabel')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((employee) => (
            <tr key={employee.id} className={listTable.row}>
              <td className={listTable.td}>
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(employee.id)}
                    className="cursor-pointer truncate text-left hover:underline"
                  >
                    {fullName(employee)}
                  </button>
                ) : (
                  fullName(employee)
                )}
                {employee.employee_number && (
                  <span className="ml-2 font-mono text-caption text-muted-foreground">
                    {employee.employee_number}
                  </span>
                )}
              </td>
              <td className={listTable.td}>{employee.position ?? '—'}</td>
              <td className={listTable.td}>{employee.department ?? '—'}</td>
              <td className={cn(listTable.td, 'text-muted-foreground')}>
                {formatDate(employee.employment_start)}
              </td>
              <td className={listTable.td}>
                <EmployeeStatusBadge status={employee.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={cn(listTable.list, 'lg:hidden')}>
        {rows.map((employee) => {
          const content = (
            <>
              <span className="grid min-w-0 flex-1 leading-snug">
                <span className="truncate text-title-sm">{fullName(employee)}</span>
                <span className="truncate text-body-sm text-muted-foreground">
                  {[employee.position, employee.department].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <EmployeeStatusBadge status={employee.status} />
            </>
          )
          return (
            <li key={employee.id}>
              {onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(employee.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {content}
                </button>
              ) : (
                <div className="flex w-full items-center gap-3 px-4 py-3">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function NewEmployee({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (employee: Employee) => void
}) {
  const settings = useEmploymentSettings()
  if (!settled(settings))
    return <FormSheetLoading title={translate('employeeNewTitle')} onClose={onClose} />
  return <EmployeeForm settings={settings.data} onClose={onClose} onSaved={onSaved} />
}

function EditEmployee({ id, onClose }: { id: string; onClose: () => void }) {
  const employee = useEmployee(id)
  if (!employee.data)
    return <FormSheetLoading title={translate('employeeEditTitle')} onClose={onClose} />
  return <EmployeeForm employee={employee.data} onClose={onClose} onSaved={onClose} />
}
