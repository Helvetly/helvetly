'use client'
import { Button } from '@helvetly/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@helvetly/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { fieldSurface } from '@helvetly/ui/lib/field-surface'
import { formatDate } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Link2, Search, X } from 'lucide-react'
import { useState } from 'react'

import { FileIcon } from '@/components/import/import-files'
import { contentUrl, useDocList } from '@/lib/documents'
import { translate } from '@/lib/i18n'

import { quietValue } from './date-fields'

/** A document's name without its extension: "Contract C23-25-CP2302.pdf" → "Contract C23-25-CP2302". */
export const baseName = (name: string) => name.replace(/\.[^./\\]{1,8}$/, '')

/** The contract number in a file name when there is one ("…C23-25-CP2302.pdf"), else the name itself. */
export function numberFromName(name: string) {
  const base = baseName(name)
  const found = base.match(/[A-Z]{0,6}\d[\w/.-]*\d|\d{3,}/i)?.[0]
  return (found ?? base).slice(0, 100)
}

/**
 * The contract an invoice refers to: its number typed in, or taken from a contract in Documents that is linked to
 * the invoice (the number is suggested from its name; the link opens it). The number is printed and sent in
 * e-invoices; the link stays in Helvetly.
 */
export function ContractField({
  id,
  value,
  document,
  onChange,
  onLink,
}: {
  id: string
  value: string
  document: { id: string; name: string } | null
  onChange: (value: string) => void
  /** A picked document, or null to unlink; the number follows the document when it was empty. */
  onLink: (document: { id: string; name: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = new URLSearchParams({ sort: '-updated_at', page_size: '20' })
  if (search.trim()) query.set('search', search.trim())
  const list = useDocList(query, open)
  const files = list.data?.data ?? []

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <input
        id={id}
        value={value}
        maxLength={100}
        onChange={(event) => onChange(event.target.value)}
        placeholder={translate('contractNumberPlaceholder')}
        className={cn(quietValue, 'min-w-0 flex-1')}
      />
      {document ? (
        <span className="flex shrink-0 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-xs" className="text-brand">
                <a
                  href={contentUrl(document.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={translate('contractOpenDocument', { name: document.name })}
                >
                  <FileIcon name={document.name} className="size-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{document.name}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('contractUnlink')}
                onClick={() => onLink(null)}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{translate('contractUnlink')}</TooltipContent>
          </Tooltip>
        </span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate('contractLinkDocument')}
                  className="shrink-0 text-muted-foreground"
                >
                  <Link2 />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{translate('contractLinkDocument')}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="grid w-[min(360px,calc(100vw-2rem))] gap-2 p-2">
            <label
              data-field-surface
              className={cn(
                fieldSurface,
                'flex h-9 items-center gap-2 px-2.5 text-muted-foreground focus-within:text-foreground',
              )}
            >
              <Search className="size-4 shrink-0 stroke-[1.5]" />
              <input
                type="search"
                aria-label={translate('contractSearchDocuments')}
                placeholder={translate('contractSearchDocuments')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-body text-foreground outline-none placeholder:text-placeholder"
              />
            </label>
            <ul aria-label={translate('documents')} className="grid max-h-64 overflow-y-auto">
              {files.length === 0 && (
                <li className="px-2 py-3 text-caption text-muted-foreground">
                  {list.isPending ? translate('loading') : translate('contractNoDocuments')}
                </li>
              )}
              {files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onLink({ id: file.id, name: file.name })
                      if (!value.trim()) onChange(numberFromName(file.name))
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm hover:bg-muted"
                  >
                    <FileIcon name={file.name} />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {formatDate(file.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
