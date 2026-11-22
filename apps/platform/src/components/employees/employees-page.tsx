'use client'

import { Button } from '@helvetly/ui/components/button'
import { DataTable, listTable, type DataColumn } from '@helvetly/ui/components/data-table'
import { DropdownMenuItem } from '@helvetly/ui/components/dropdown-menu'
import { HelpTip } from '@helvetly/ui/components/form-field'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import {
  Archive,
  CalendarClock,
  Download,
  IdCard,
  ScrollText,
  SearchX,
  Settings,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ListFilters } from '@/components/data/list-filters'
import { ListSearch, ListToolbar } from '@/components/data/list-toolbar'
import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { PageIntro } from '@/components/settings/layout'
import { PageHeader } from '@/components/shell/page-header'
import {
  fullName,
  listParamsToQuery,
  parseListParams,
  SORT_FIELDS,
  STATUSES,
  useEmployee,
  useEmployeeList,
  useEmploymentSettings,
  type Employee,
  type ListParams,
  type SortField,
} from '@/lib/employees'
import { translate } from '@/lib/i18n'
import { oneValue, shownElsewhere, type QueryField } from '@/lib/list-query'
import { setUrlQuery } from '@/lib/url-query'

import { EmployeeDetail } from './employee-detail'
import { EmployeeForm } from './employee-form'
import { EmployeeStatusBadge } from './employee-status'
import { HrLockNotice, HrUpsell, useHrAccess, useHrTabs } from './hr-access'
import { RetentionReview } from './retention-review'

/** The status tabs: every status the model has, then everyone. */
const STATUS_TABS = STATUSES
const TAB_ICONS = [UserCheck, CalendarClock, UserMinus, Archive, Users]

/**
 * The search's field terms. `status:` switches the tab; the department and the start range are
 * the Filters popover's controls and show as chips.
 */
const queryFields = (departments: string[]): QueryField<ListParams>[] => [
  {
    id: 'status',
    label: translate('employeeStatusLabel'),
    type: 'enum',
    values: STATUSES,
    ...shownElsewhere((value) => {
      const status = STATUSES.find((entry) => entry.value === value)?.value
      return status ? { status } : {}
    }),
  },
  {
    id: 'department',
    label: translate('employeeDepartment'),
    type: 'enum',
    values: departments.map((department) => ({ value: department, label: department })),
    placeholder: translate('anyDepartment'),
    ...oneValue(
      (params: ListParams) => params.department,
      (department) => ({ department }),
    ),
  },
  {
    id: 'from',
    label: translate('from'),
    type: 'date',
    placeholder: translate('anyDate'),
    until: 'to',
    ...oneValue(
      (params: ListParams) => params.startFrom || null,
      (from) => ({ startFrom: from ?? '' }),
    ),
  },
  {
    id: 'to',
    label: translate('to3'),
    type: 'date',
    ...oneValue(
      (params: ListParams) => params.startTo || null,
      (to) => ({ startTo: to ?? '' }),
    ),
  },
]

/** Employees: the company's staff, apart from the members who use Helvetly. */
export function EmployeesPage() {
  const pathname = usePathname()
  const query = useSearchParams()
  const params = parseListParams(query)
  const hr = useHrAccess()
  const hrTabs = useHrTabs('employees')
  // The status tabs come first; Payroll (when readable) is the last tab and opens its own page.
  const payroll = hrTabs.tabs.length > 1 ? hrTabs : null
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
  const filtered =
    params.search !== '' ||
    params.department !== null ||
    params.startFrom !== '' ||
    params.startTo !== ''
  // An empty list has one first action, in the empty state; the header's comes back with the first employee.
  const empty = list.data !== undefined && rows.length === 0 && !filtered
  const create = () => go({ new: '1' }, true)

  return (
    <>
      <PageHeader
        tabs={[
          ...STATUS_TABS.map((entry) => entry.label),
          ...(payroll ? [payroll.tabs[1] ?? ''] : []),
        ]}
        tabIcons={[...TAB_ICONS, ...(payroll ? [payroll.tabIcons[1] ?? Users] : [])]}
        savedViews={false}
        active={STATUS_TABS.findIndex((entry) => entry.value === params.status)}
        onSelect={(index) =>
          index < STATUS_TABS.length
            ? setParams({ status: STATUS_TABS[index]?.value ?? 'active' })
            : payroll?.onSelect(1)
        }
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
      <PageIntro
        title={translate('employees')}
        description={translate('employeesPageDescription')}
        className="px-3 pt-4 md:px-5"
      />
      <HrLockNotice hr={hr} />
      {hr.blocked ? (
        <HrUpsell hr={hr} />
      ) : (
        <div className="flex flex-1 flex-col">
          <ListToolbar className="flex-wrap gap-2 px-3 py-2 md:px-5">
            <ListFilters fields={queryFields(departments)} params={params} onChange={setParams} />
            <ListSearch
              className="min-w-40 max-sm:basis-full"
              label={translate('employeeSearchLabel')}
              placeholder={translate('employeeSearchPlaceholder')}
              value={search}
              onChange={setSearch}
              query={{ fields: queryFields(departments), params, onChange: setParams }}
            />
            <HelpTip label={translate('employeeAndMembersLabel')}>
              {translate('employeeAndMembersTip')}
            </HelpTip>
          </ListToolbar>

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
                      setParams({ search: '', department: null, startFrom: '', startTo: '' })
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
            <EmployeeRows
              rows={rows}
              sort={params.sort}
              onSort={(field, desc) => setParams({ sort: { field, desc } })}
              onOpen={canOpen ? (id) => go({ id }, true) : undefined}
            />
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

function EmployeeRows({
  rows,
  sort,
  onSort,
  onOpen,
}: {
  rows: Employee[]
  sort: ListParams['sort']
  onSort: (field: SortField, desc: boolean) => void
  onOpen?: (id: string) => void
}) {
  return (
    <>
      <DataTable
        id="employees"
        className="hidden lg:table"
        columns={employeeColumns(onOpen)}
        data={rows}
        getRowId={(employee) => employee.id}
        sorting={{
          column: sort.field,
          desc: sort.desc,
          onSort: (column, desc) => {
            const field = SORT_FIELDS.find((entry) => entry === column)
            if (field) onSort(field, desc)
          },
        }}
      />
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

function employeeColumns(onOpen?: (id: string) => void): DataColumn<Employee>[] {
  return [
    {
      id: 'name',
      header: translate('employeeColName'),
      flex: true,
      sortable: true,
      cell: (employee) => (
        <>
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
            <span className="font-code ml-2 text-caption text-muted-foreground">
              {employee.employee_number}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'position',
      header: translate('employeePosition'),
      size: 200,
      minSize: 96,
      sortable: true,
      cell: (employee) => employee.position ?? '—',
    },
    {
      id: 'department',
      header: translate('employeeDepartment'),
      size: 160,
      minSize: 112,
      sortable: true,
      cell: (employee) => employee.department ?? '—',
    },
    {
      id: 'since',
      header: translate('employeeColSince'),
      size: 128,
      minSize: 96,
      sortable: true,
      sortDescFirst: true,
      className: 'text-muted-foreground',
      cell: (employee) => formatDate(employee.employment_start),
    },
    {
      id: 'status',
      header: translate('employeeStatusLabel'),
      size: 132,
      cell: (employee) => <EmployeeStatusBadge status={employee.status} />,
    },
  ]
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
