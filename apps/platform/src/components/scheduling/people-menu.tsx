'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { ChevronDown, Users } from 'lucide-react'

import { translate } from '@/lib/i18n'

import { HostDot } from './bits'

export type HostMode = 'me' | 'all' | 'pick'
type Option = { value: string; label: string }

/** Whose sessions show: mine, everyone's, or the hosts ticked. */
export function PeopleMenu({
  mode,
  picked,
  options,
  onMode,
  onPicked,
}: {
  mode: HostMode
  picked: string[]
  options: Option[]
  onMode: (mode: 'me' | 'all') => void
  onPicked: (picked: string[]) => void
}) {
  const label =
    mode === 'all'
      ? translate('schedEveryone')
      : mode === 'pick' && picked.length === 1
        ? (options.find((option) => option.value === picked[0])?.label ??
          translate('schedHostsCount', { count: 1 }))
        : mode === 'pick'
          ? translate('schedHostsCount', { count: picked.length })
          : translate('schedMySessions')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-w-56">
          <Users />
          <span className="sr-only">{translate('schedHosts')}: </span>
          <span className="truncate">{label}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-56">
        <DropdownMenuRadioGroup
          value={mode === 'pick' ? '' : mode}
          onValueChange={(next) => onMode(next === 'all' ? 'all' : 'me')}
        >
          <DropdownMenuRadioItem value="me">{translate('schedMySessions')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">{translate('schedEveryone')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {options.length > 0 && <DropdownMenuSeparator />}
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={mode === 'pick' && picked.includes(option.value)}
            // Ticking several hosts in a row keeps the menu open.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              const rest = mode === 'pick' ? picked.filter((id) => id !== option.value) : []
              onPicked(checked ? [...rest, option.value] : rest)
            }}
          >
            <HostDot id={option.value} />
            <span className="truncate">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
