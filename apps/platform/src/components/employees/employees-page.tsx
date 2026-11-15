'use client'

import { Button } from '@helvetly/ui/components/button'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { formatDate } from '@helvetly/ui/lib/format'
import { Banknote, IdCard, Search, SearchX, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { NativeSelect } from '@/components/clients/fields'
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
import { useCan } from '@/lib/permissions'
import { setUrlQuery } from '@/lib/url-query'

import { EmployeeDetail } from './employee-detail'
import { EmployeeForm } from './employee-form'
import { EmployeeStatusBadge } from './employee-status'

/** Employees: the company's staff, apart from the members who use Helvetly. */
export function EmployeesPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const list = useEmployeeList(params)
  const canWrite = useCan('write:employees')
  const canPayroll = useCan('read:payroll')
  const openId = query.get('id')
  const editId = query.get('edit')
  const creating = query.get('new') === '1' && canWrite
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

  return (
    <>
      <PageHeader
        tabs={['Employees']}
        tabIcons={[IdCard]}
        savedViews={false}
        primary={canWrite ? 'New employee' : undefined}
        onPrimary={() => go({ new: '1' }, true)}
        actions={
          canPayroll ? (
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <Link href="/employees/payroll">
                <Banknote className="size-3.5" /> Payroll
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-5">
          <label className="flex h-8 min-w-40 flex-1 items-center gap-2 rounded-md px-2 text-muted-foreground focus-within:text-foreground">
            <Search className="size-4 shrink-0 stroke-[1.5]" />
            <input
              type="search"
              aria-label="Search employees"
              placeholder="Search by name, number or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full min-w-0 bg-transparent text-title-sm text-foreground outline-none placeholder:text-placeholder"
            />
          </label>
          <NativeSelect
            aria-label="Status"
            wrapperClassName="w-36"
            className="h-8"
            value={params.status}
            onChange={(event) =>
              setParams({
                status:
                  STATUSES.find((status) => status.value === event.target.value)?.value ?? 'active',
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
            aria-label="Department"
            wrapperClassName="w-44"
            className="h-8"
            disabled={departments.length === 0}
            value={params.department ?? ''}
            onChange={(event) => setParams({ department: event.target.value || null })}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department}>{department}</option>
            ))}
          </NativeSelect>
          <span className="flex items-center gap-1 px-1 text-body-sm text-muted-foreground">
            Employees and members
            <HelpTip label="Employees and members">
              Employees are your company’s staff. Members are the people who have access to
              Helvetly. Adding an employee gives no access, sends no invitation and adds no paid
              seat. An employee can be linked to a member, which grants nothing.
            </HelpTip>
          </span>
        </div>

        {list.error ? (
          <LoadProblem
            error={list.error}
            what="The employees"
            onRetry={() => void list.refetch()}
          />
        ) : !list.data ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          filtered ? (
            <State
              icon={<SearchX />}
              title="Nobody matches"
              text="Try another word, status or department."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setParams({ search: '', status: 'active', department: null })
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <State
              icon={<IdCard />}
              title="No employees yet"
              text="Keep your staff’s records, pay terms, documents and payroll here. Employees don’t get access to Helvetly."
              action={
                canWrite ? (
                  <Button size="sm" className="gap-1.5" onClick={() => go({ new: '1' }, true)}>
                    <UserPlus className="size-3.5" /> New employee
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <EmployeeRows rows={rows} onOpen={(id) => go({ id }, true)} />
        )}
      </div>

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
    </>
  )
}

function EmployeeRows({ rows, onOpen }: { rows: Employee[]; onOpen: (id: string) => void }) {
  return (
    <>
      <table className="hidden w-full table-fixed text-title-sm lg:table">
        <thead>
          <tr className="h-11 border-b bg-muted/50 text-left text-body-sm text-muted-foreground">
            <th className="w-[30%] pl-5 font-medium">Name</th>
            <th className="w-[22%] px-3 font-medium">Position</th>
            <th className="w-[16%] px-3 font-medium">Department</th>
            <th className="w-[16%] px-3 font-medium">Since</th>
            <th className="w-[16%] px-3 pr-5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((employee) => (
            <tr key={employee.id} className="h-[54px] hover:bg-card/70">
              <td className="truncate pl-5">
                <button
                  type="button"
                  onClick={() => onOpen(employee.id)}
                  className="cursor-pointer truncate text-left hover:underline"
                >
                  {fullName(employee)}
                </button>
                {employee.employee_number && (
                  <span className="ml-2 font-mono text-caption text-muted-foreground">
                    {employee.employee_number}
                  </span>
                )}
              </td>
              <td className="truncate px-3">{employee.position ?? '—'}</td>
              <td className="truncate px-3">{employee.department ?? '—'}</td>
              <td className="px-3 text-muted-foreground">
                {formatDate(employee.employment_start)}
              </td>
              <td className="px-3 pr-5">
                <EmployeeStatusBadge status={employee.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border/70 lg:hidden">
        {rows.map((employee) => (
          <li key={employee.id}>
            <button
              type="button"
              onClick={() => onOpen(employee.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="grid min-w-0 flex-1 leading-snug">
                <span className="truncate text-title-sm">{fullName(employee)}</span>
                <span className="truncate text-body-sm text-muted-foreground">
                  {[employee.position, employee.department].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <EmployeeStatusBadge status={employee.status} />
            </button>
          </li>
        ))}
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
  if (!settled(settings)) return <FormSheetLoading title="New employee" onClose={onClose} />
  return <EmployeeForm settings={settings.data} onClose={onClose} onSaved={onSaved} />
}

function EditEmployee({ id, onClose }: { id: string; onClose: () => void }) {
  const employee = useEmployee(id)
  if (!employee.data) return <FormSheetLoading title="Edit employee" onClose={onClose} />
  return <EmployeeForm employee={employee.data} onClose={onClose} onSaved={onClose} />
}
