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
import { translate } from '@/lib/i18n'
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
      <LoadProblem
        error={list.error}
        what={translate('theTemplates')}
        onRetry={() => void list.refetch()}
      />
    )
  if (list.isPending) return <LoadingRows />
  if (templates.length === 0)
    return (
      <State
        icon={<LayoutTemplate />}
        title={translate('noTemplatesYet')}
        text={translate('turnAContractOfferOrLetterIntoATemplate')}
        action={
          <Button size="sm" className="cursor-pointer gap-1.5" onClick={onCreate}>
            <Plus className="size-4" />
            {translate('newTemplate')}
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
                      `${template.document?.name ?? translate('pdfRemoved')} · ${countLabel(template)}`}
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
                  <StatusBadge tone="gray">{translate('noSignatures')}</StatusBadge>
                )}
              </span>
              <span className="text-[12.5px] text-muted-foreground max-md:hidden">
                {template.last_used_at
                  ? translate('used2', { value1: formatRelative(template.last_used_at) })
                  : translate('notUsedYet')}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate('moreFor', { name: template.name })}
                  className="absolute top-1/2 right-4 -translate-y-1/2 cursor-pointer"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => onUse(template)}>
                  <LayoutTemplate />
                  {translate('useForAClient')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(template)}>
                  <Pencil />
                  {translate('editTemplate')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(template)}>
                  <Trash2 />
                  {translate('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDialog
          tone="destructive"
          title={translate('delete8', { name: deleting.name })}
          body={translate('documentsAlreadyMadeFromItStayInDocumentsThe')}
          confirmLabel={translate('deleteTemplate')}
          cancelLabel={translate('cancel')}
          onDecide={(confirmed) => {
            const target = deleting
            setDeleting(null)
            if (confirmed)
              remove.mutate(target.id, {
                onSuccess: () => toast.success(translate('templateDeleted')),
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
