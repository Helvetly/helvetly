'use client'
import { cn } from '@helvetly/ui/lib/utils'

import './settings.css'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { SectionFooter, type SectionState } from '@/components/section-form'
import { translate } from '@/lib/i18n'

/**
 * A settings page under the settings tabs: its title, what it is for, and its sections as bands
 * divided by hairlines. `nav` lists the page's own sections in a sticky column on a wide panel
 * (invoice settings); `aside` is a column beside the sections on very wide screens (the VAT return's
 * summary).
 */
export function SettingsPage({
  title,
  description,
  actions,
  nav,
  aside,
  children,
}: {
  title: string
  description: ReactNode
  /** The page's own controls, right of its title. */
  actions?: ReactNode
  nav?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex-1">
      <div
        data-slot="settings-page"
        className={cn(
          // The whole panel's width (the page header's hairline runs edge to edge): fields and long text cap their own width (settings.css).
          'grid w-full items-start gap-x-10 gap-y-6 px-4 pt-5 pb-24 sm:px-6 md:pt-7 lg:px-8',
          nav && '@4xl:grid-cols-[11.5rem_minmax(0,1fr)]',
        )}
      >
        {/* Above the page's own nav too: one title line and hairline on every settings tab. */}
        <div
          data-slot="settings-page-header"
          className="col-span-full -mx-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b px-4 pb-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
        >
          <div className="grid max-w-[68ch] min-w-0 gap-1">
            <h1 className="text-title font-semibold tracking-[-0.015em]">{title}</h1>
            <p
              data-slot="settings-page-description"
              className="text-body-sm text-pretty text-muted-foreground"
            >
              {description}
            </p>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {nav && (
          <nav
            aria-label={translate('sections')}
            className="hidden h-fit gap-0.5 @4xl:sticky @4xl:top-[76px] @4xl:grid"
          >
            {nav}
          </nav>
        )}
        <div
          className={cn(
            'grid min-w-0 items-start gap-x-8 gap-y-5',
            aside && '@5xl:grid-cols-[minmax(0,1fr)_19rem]',
          )}
        >
          {aside && (
            <aside className="@5xl:sticky @5xl:top-[76px] @5xl:col-start-2 @5xl:row-start-1">
              {aside}
            </aside>
          )}
          <div
            data-slot="settings-sections"
            className={cn(
              '@container/sections grid min-w-0 gap-7',
              aside && '@5xl:col-start-1 @5xl:row-start-1',
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A notice for the whole page (e.g. "Ready to issue invoices") among its sections: as wide as the
 * sections' title column and form grid together, never the whole panel (settings.css).
 */
export function SettingsNotice({ children }: { children: ReactNode }) {
  return <div data-slot="settings-notice">{children}</div>
}

/**
 * One settings section: a band across the page with its title and what it is for on the left and its
 * rows on the right (see settings.css), divided from the next section by a hairline. A section that
 * saves gets a footer with Discard and Save under its rows (⌘/Ctrl+Enter saves it too). `action` is
 * the section's own button, under its description. `icon` is drawn small and muted before the title.
 */
export function SettingsSection({
  id,
  title,
  description,
  action,
  section,
  icon: Icon,
  tone,
  className,
  hidden,
  children,
  ...data
}: {
  id: string
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** The section's own button (e.g. Download), under its description. */
  action?: ReactNode
  section?: SectionState
  /** "danger": what can't be undone; it ends the page, its title in red. */
  tone?: 'danger'
  className?: string
  /** Kept mounted but out of view, e.g. one of several editors of which one is shown. */
  hidden?: boolean
  children?: ReactNode
  'data-section'?: string
}) {
  return (
    <section
      id={id}
      hidden={hidden}
      aria-labelledby={`${id}-title`}
      ref={section?.attach}
      data-slot="settings-section"
      data-section={data['data-section']}
      data-tone={tone}
      className={cn(
        'grid scroll-mt-20 gap-x-10 gap-y-4 border-t pt-7 first:border-t-0 first:pt-0 @4xl/sections:grid-cols-[var(--settings-label)_minmax(0,1fr)]',
        className,
      )}
    >
      <header className="grid content-start gap-1">
        <h2
          id={`${id}-title`}
          className={cn(
            'flex items-center gap-2 text-body font-semibold',
            tone === 'danger' && 'text-destructive',
          )}
        >
          {Icon && (
            <Icon
              aria-hidden
              data-slot="settings-section-icon"
              className={cn(
                'size-4 shrink-0 stroke-[1.75]',
                tone !== 'danger' && 'text-muted-foreground',
              )}
            />
          )}
          {title}
        </h2>
        {description && (
          <p className="text-body-sm text-pretty text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>}
      </header>
      <div className="@container grid min-w-0 content-start gap-3">
        {children && <div data-slot="settings-fields">{children}</div>}
        {section && (section.dirty || section.saving || section.saved) && (
          <div
            data-slot="settings-section-footer"
            className={cn(
              'w-full max-w-[var(--settings-form,44rem)] animate-in rounded-lg bg-muted/40 px-3 py-1.5 transition-colors duration-200 fade-in',
              // Unsaved: tinted, and on a phone it stays in view until saved or discarded.
              'has-[[data-dirty]]:bg-muted max-sm:has-[[data-dirty]]:sticky max-sm:has-[[data-dirty]]:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] max-sm:has-[[data-dirty]]:z-10',
            )}
          >
            <SectionFooter state={section} className="bg-transparent px-0 ring-0 max-sm:static" />
          </div>
        )}
      </div>
    </section>
  )
}

/** Fields of one section as rows of the settings form grid (settings.css). */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div data-slot="settings-fields">{children}</div>
}

/**
 * A live example of a setting in a section's form grid: the next invoice number, when reminders go
 * out. `items` show as label and value pairs (values in mono); `children` as one sentence.
 */
export function SettingsPreview({
  label,
  items,
  children,
}: {
  label: string
  items?: { label: string; value: string }[]
  children?: ReactNode
}) {
  return (
    <output
      aria-label={label}
      data-slot="settings-preview"
      className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-body-sm text-muted-foreground"
    >
      {items?.map((item) => (
        <span key={item.label} className="flex items-baseline gap-2">
          {item.label}
          <span className="font-mono text-foreground tabular-nums">{item.value}</span>
        </span>
      ))}
      {children && <span className="text-pretty">{children}</span>}
    </output>
  )
}

/**
 * A row with a title and a sentence on the left and its button(s) on the right: Download, Log out,
 * Delete. "danger" makes the title red.
 */
export function ActionRow({
  title,
  description,
  tone,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <div
      data-slot="action-row"
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3"
    >
      <div className="grid min-w-0 flex-1 basis-72 gap-0.5">
        <p className={cn('text-body font-medium', tone === 'danger' && 'text-destructive')}>
          {title}
        </p>
        {description && (
          <p className="max-w-[68ch] text-body-sm leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** One row of a list in a section: an outlined icon, two lines of text, actions on the right. */
export function SettingsRow({
  icon,
  title,
  meta,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  meta: ReactNode
  children?: ReactNode
}) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      <span
        data-slot="row-icon"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{title}</span>
        <span className="text-body-sm text-pretty text-muted-foreground">{meta}</span>
      </span>
      {children && <span className="flex shrink-0 items-center gap-1">{children}</span>}
    </li>
  )
}

/**
 * What a section shows while it has nothing to list: an icon, what is missing and how to add it.
 * `action` is the way to add the first one (its primary button), under the sentence; the section
 * shows its own add button only once there is something listed.
 */
export function SettingsEmpty({
  icon,
  title,
  action,
  children,
}: {
  icon: ReactNode
  title: string
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    // Centred and quiet: no box of its own inside the card, the icon on a brand tile.
    <div
      data-slot="settings-empty"
      className="grid justify-items-center gap-3 px-4 py-8 text-center"
    >
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-xl bg-brand-surface text-brand [&_svg]:size-5 [&_svg]:stroke-[1.75]"
      >
        {icon}
      </span>
      <span className="grid max-w-sm gap-1">
        <span className="text-body font-medium">{title}</span>
        {children && (
          <span className="text-body-sm text-pretty text-muted-foreground">{children}</span>
        )}
      </span>
      {action && (
        <div data-slot="settings-empty-action" className="mt-1 flex flex-wrap justify-center gap-2">
          {action}
        </div>
      )}
    </div>
  )
}
