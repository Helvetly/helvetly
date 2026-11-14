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

import { useHeidi } from '@/components/heidi/heidi-provider'
import { useOpenNotificationPrefs } from '@/components/notifications/prefs-drawer'
import { useOpenHref } from '@/components/record-link'
import { ShortcutKeys } from '@/components/shortcuts/shortcut-keys'
import { nextTheme } from '@/components/shortcuts/theme-shortcut'
import { effectiveSearch, useClientSearch } from '@/lib/clients'
import { can, useScopes } from '@/lib/permissions'

import { CREATE_ACTIONS, visibleNav } from './nav'

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
      title="Quick Actions"
      description="Jump anywhere in Helvetly or start something new"
    >
      <Command label="Search pages and actions">
        <CommandInput
          placeholder="Search pages, actions and clients…"
          value={term}
          onValueChange={setTerm}
        />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          {clients.length > 0 && (
            <>
              <CommandGroup heading="Clients">
                {clients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`${client.name} #${client.number} ${client.number} ${client.email ?? ''} ${term}`}
                    onSelect={run(() => openHref(`/clients?id=${encodeURIComponent(client.id)}`))}
                  >
                    <Building2 /> {client.name}
                    <CommandShortcut className="tracking-normal tabular-nums">
                      #{client.number}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading="Go to">
            {visibleNav(scopes)
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
              <KeyRound /> Account settings: passkeys, 2FA & sessions
            </CommandItem>
            <CommandItem onSelect={run(openPrefs)}>
              <BellRing /> Notification preferences: email and bell
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Create">
            {CREATE_ACTIONS.filter(({ need }) => can(scopes, need)).map(({ label, href }) => (
              <CommandItem
                key={label}
                onSelect={run(() => (href ? router.push(href) : toast(`${label} is coming soon.`)))}
              >
                <Plus /> {label}
              </CommandItem>
            ))}
            <CommandItem onSelect={run(() => heidi?.ask())}>
              <Sparkle /> Ask Heidi
              <CommandShortcut>
                <ShortcutKeys id="heidi" />
              </CommandShortcut>
            </CommandItem>
            {onHelp && (
              <CommandItem onSelect={run(onHelp)}>
                <LifeBuoy /> Help & feedback
                <CommandShortcut>
                  <ShortcutKeys id="help" />
                </CommandShortcut>
              </CommandItem>
            )}
            {onShortcuts && (
              <CommandItem onSelect={run(onShortcuts)}>
                <Keyboard /> Keyboard shortcuts
                <CommandShortcut>
                  <ShortcutKeys id="shortcuts" />
                </CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Theme">
            <CommandItem onSelect={run(() => setTheme(nextTheme(theme)))}>
              <SunMoon /> Next theme
              <CommandShortcut>
                <ShortcutKeys id="theme" />
              </CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('light'))}>
              <Sun /> Light
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('dark'))}>
              <Moon /> Dark
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme('system'))}>
              <Monitor /> System
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
