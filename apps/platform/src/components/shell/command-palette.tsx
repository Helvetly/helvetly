'use client'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@helvetly/ui/components/command'
import {
  BellRing,
  Building2,
  Keyboard,
  KeyRound,
  LifeBuoy,
  Monitor,
  Moon,
  Plus,
  Sparkle,
  Sun,
  SunMoon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useBillingStatus } from '@/components/billing/feature-lock'
import { useHeidi } from '@/components/heidi/heidi-provider'
import { useOpenNotificationPrefs } from '@/components/notifications/prefs-drawer'
import { useOpenHref } from '@/components/record-link'
import { ShortcutKeys } from '@/components/shortcuts/shortcut-keys'
import { nextTheme } from '@/components/shortcuts/theme-shortcut'
import { effectiveSearch, useClientSearch } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import { can, useScopes } from '@/lib/permissions'

import { startable, visibleNav } from './nav'

/** Quick Actions: jump to any page, start a new record, ask Heidi, switch the theme. */
export function CommandPalette({
  open,
  onOpenChange,
  onHelp,
  onShortcuts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onHelp?: () => void
  onShortcuts?: () => void
}) {
  const router = useRouter()
  const openPrefs = useOpenNotificationPrefs()
  const openHref = useOpenHref()
  const scopes = useScopes()
  const { billing, loading: billingPending } = useBillingStatus()
  const { theme, setTheme } = useTheme()
  const heidi = useHeidi()
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250)
    return () => clearTimeout(timer)
  }, [term])
  // Clients by name or number, searched on the server once something was typed.
  const search = useClientSearch(
    debounced,
    open && effectiveSearch(debounced) !== '' && can(scopes, 'read:clients'),
  )
  const clients = effectiveSearch(debounced) ? (search.data?.data ?? []) : []

  const run = (action: () => void) => () => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={translate('quickActions')}
      description={translate('jumpAnywhereInHelvetlyOrStartSomethingNew')}
    >
      <Command label={translate('searchPagesAndActions')}>
        <CommandInput
          placeholder={translate('searchPagesActionsAndClients')}
          value={term}
          onValueChange={setTerm}
        />
        <CommandList>
          <CommandEmpty>{translate('nothingFound')}</CommandEmpty>
          {clients.length > 0 && (
            <>
              <CommandGroup heading={translate('clients')}>
                {clients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`${client.name} #${client.number} ${client.number} ${client.email ?? ''} ${term}`}
                    onSelect={run(() => openHref(`/clients?id=${encodeURIComponent(client.id)}`))}
                  >
                    <Building2 /> {client.name}
                    <CommandShortcut className="font-code tracking-normal">
                      #{client.number}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading={translate('goTo')}>
            {visibleNav(scopes, billing, billingPending)
              .flatMap((group) => group.items)
              .filter((item) => item.href)
              .map(({ label, icon: Icon, href }) => (
                <CommandItem key={label} onSelect={run(() => router.push(href ?? '/'))}>
                  <Icon /> {label}
                  {href === '/notifications' && (
                    <CommandShortcut>
                      <ShortcutKeys id="notifications" />
                    </CommandShortcut>
                  )}
                </CommandItem>
              ))}
            <CommandItem onSelect={run(() => router.push('/account'))}>
              <KeyRound />
              {translate('accountSettingsPasskeys2FASessions')}
            </CommandItem>
            <CommandItem onSelect={run(openPrefs)}>
              <BellRing />
              {translate('notificationPreferencesEmailAndBell')}
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={translate('create')}>
            {startable(scopes, billing).map(({ label, href }) => (
              <CommandItem
                key={label}
                onSelect={run(() =>
                  href ? router.push(href) : toast(translate('isComingSoon', { label: label })),
                )}
              >
                <Plus /> {label}
              </CommandItem>
            ))}
            <CommandItem onSelect={run(() => heidi?.ask())}>
              <Sparkle />
              {translate('askHeidi3')}
              <CommandShortcut>
                <ShortcutKeys id="heidi" />
              </CommandShortcut>
            </CommandItem>
            {onHelp && (
              <CommandItem onSelect={run(onHelp)}>
                <LifeBuoy />
                {translate('helpFeedback2')}
                <CommandShortcut>
                  <ShortcutKeys id="help" />
                </CommandShortcut>
              </CommandItem>
            )}
            {onShortcuts && (
              <CommandItem onSelect={run(onShortcuts)}>
                <Keyboard />
                {translate('keyboardShortcuts')}
                <CommandShortcut>
                  <ShortcutKeys id="shortcuts" />
                </CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={translate('theme')}>
            <CommandItem onSelect={run(() => setTheme(nextTheme(theme)))}>
              <SunMoon />
              {translate('nextTheme')}
              <CommandShortcut>
                <ShortcutKeys id="theme" />
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('light'))}>
              <Sun />
              {translate('light')}
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('dark'))}>
              <Moon />
              {translate('dark')}
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('system'))}>
              <Monitor />
              {translate('system2')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
