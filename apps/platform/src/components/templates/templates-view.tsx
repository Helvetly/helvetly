'use client'

import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { StatusBadge } from '@helvetly/ui/components/status-badge'
import { formatRelative } from '@helvetly/ui/lib/format'
import { Ellipsis, FileSignature, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadProblem } from '@/components/data/load-problem'
import { LoadingRows, State } from '@/components/data/table-page'
import {
  isDataKind,
  templatesApi,
  useTemplateMutation,
  useTemplates,
  type Template,
} from '@/lib/templates'

/** The Templates section of Documents: PDFs filled from a client's details, optionally signed. */
export function TemplatesView({
  onUse,
  onEdit,
  onCreate,
}: {
  onUse: (template: Template) => void
  onEdit: (template: Template) => void
  onCreate: () => void
}) {
  const list = useTemplates()
  const templates = list.data ?? []
  const [deleting, setDeleting] = useState<Template | null>(null)
  const remove = useTemplateMutation((id: string) => templatesApi.remove(id))

  if (list.error)
    return (
      <LoadProblem error={list.error} what="The templates" onRetry={() => void list.refetch()} />
    )
  if (list.isPending) return <LoadingRows />
  if (templates.length === 0)
    return (
      <State
        icon={<LayoutTemplate />}
        title="No templates yet"
        text="Turn a contract, offer or letter into a template: place the client’s name, address and contact on it once, then make a filled-in copy for any client in a few clicks. Add signature fields to send it for signing."
        action={
          <Button size="sm" className="cursor-pointer gap-1.5" onClick={onCreate}>
            <Plus className="size-4" /> New template
          </Button>
        }
      />
    )

  return (
    <div className="flex flex-1 flex-col">
      <ul className="grid px-2 py-2 md:px-3">
        {templates.map((template) => (
          <li key={template.id} className="group/row relative">
            <button
              type="button"
              onClick={() => onUse(template)}
              className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-3 pr-14 text-left transition-colors hover:bg-foreground/[0.035] md:grid-cols-[minmax(0,1fr)_170px_150px]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <IconTile icon={LayoutTemplate} className="size-9 rounded-lg [&_svg]:size-[18px]" />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px]">{template.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {template.description ||
                      `${template.document?.name ?? 'PDF removed'} · ${countLabel(template)}`}
                  </span>
                </span>
              </span>
              <span className="max-md:hidden">
                {template.signers.length > 0 ? (
                  <StatusBadge tone="blue">
                    <FileSignature className="size-3" /> {template.signers.length}{' '}
                    {template.signers.length === 1 ? 'signer' : 'signers'}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="gray">No signatures</StatusBadge>
                )}
              </span>
              <span className="text-[12.5px] text-muted-foreground max-md:hidden">
                {template.last_used_at
                  ? `Used ${formatRelative(template.last_used_at)}`
                  : 'Not used yet'}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More for ${template.name}`}
                  className="absolute top-1/2 right-4 -translate-y-1/2 cursor-pointer"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => onUse(template)}>
                  <LayoutTemplate /> Use for a client…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(template)}>
                  <Pencil /> Edit template
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(template)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDialog
          tone="destructive"
          title={`Delete “${deleting.name}”?`}
          body="Documents already made from it stay in Documents. The PDF it is built on stays too."
          confirmLabel="Delete template"
          cancelLabel="Cancel"
          onDecide={(confirmed) => {
            const target = deleting
            setDeleting(null)
            if (confirmed)
              remove.mutate(target.id, {
                onSuccess: () => toast.success('Template deleted.'),
                onError: toastError,
              })
          }}
        />
      )}
    </div>
  )
}

function countLabel(template: Template) {
  const data = template.fields.filter((field) => isDataKind(field.kind)).length
  return `${data} client ${data === 1 ? 'field' : 'fields'}`
}
