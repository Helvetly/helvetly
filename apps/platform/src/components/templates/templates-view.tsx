'use client'
import { localizedHref } from '@helvetly/i18n'
import { Badge } from '@helvetly/ui/components/badge'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { describedBy, FormField } from '@helvetly/ui/components/form-field'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { formatRelative } from '@helvetly/ui/lib/format'
import {
  Copy,
  FileDown,
  FilePen,
  FileSignature,
  LayoutTemplate,
  Pencil,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { inputClass } from '@/components/clients/fields'
import { LoadProblem } from '@/components/data/load-problem'
import { MenuText, RowContextMenu, RowMenuButton, type RowMenuSpec } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { FormDialog } from '@/components/invoices/invoice-dialogs'
import { downloadUrl } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import {
  isDataKind,
  templateInput,
  templatesApi,
  useTemplateMutation,
  useTemplates,
  type Template,
} from '@/lib/templates'

/**
 * The Templates section of Documents: PDFs filled from a client's details, optionally signed. A row opens the
 * editor; its "…" and right-click menus hold the same actions.
 */
export function TemplatesView({
  onEdit,
  onFill,
}: {
  onEdit: (template: Template) => void
  /** Makes a document from the template (the fill drawer). */
  onFill: (template: Template) => void
}) {
  const list = useTemplates()
  const templates = list.data ?? []
  const [deleting, setDeleting] = useState<Template | null>(null)
  const [renaming, setRenaming] = useState<Template | null>(null)
  const remove = useTemplateMutation((id: string) => templatesApi.remove(id))
  const duplicate = useTemplateMutation((template: Template) => {
    const body = templateInput(template, translate('copyOfName', { name: template.name }))
    if (!body) throw new Error(`template ${template.id} has no PDF`)
    return templatesApi.create(body)
  })

  const menu = (template: Template) =>
    templateMenu(template, {
      onFill,
      onEdit,
      onRename: setRenaming,
      onDelete: setDeleting,
      duplicating: duplicate.isPending,
      onDuplicate: (target) =>
        duplicate.mutate(target, {
          onSuccess: ({ data }) =>
            toast.success(translate('templateDuplicated', { name: data.name })),
          onError: toastError,
        }),
    })

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
      />
    )

  return (
    <div className="flex flex-1 flex-col">
      <ul className="grid px-2 py-2 md:px-3">
        {templates.map((template) => (
          <RowContextMenu key={template.id} menu={menu(template)}>
            <li className="group/row relative rounded-xl">
              <button
                type="button"
                onClick={() => onEdit(template)}
                className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-3 pr-14 text-left transition-colors hover:bg-foreground/[0.035] md:grid-cols-[minmax(0,1fr)_170px_150px]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <IconTile
                    icon={LayoutTemplate}
                    className="size-9 rounded-lg [&_svg]:size-[18px]"
                  />
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
                    <Badge tone="blue">
                      <FileSignature className="size-3" /> {template.signers.length}{' '}
                      {template.signers.length === 1 ? 'signer' : 'signers'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">{translate('noSignatures')}</Badge>
                  )}
                </span>
                <span className="text-[12.5px] text-muted-foreground max-md:hidden">
                  {template.last_used_at
                    ? translate('used2', { value1: formatRelative(template.last_used_at) })
                    : translate('notUsedYet')}
                </span>
              </button>
              <span className="absolute top-1/2 right-4 -translate-y-1/2">
                <RowMenuButton
                  label={translate('moreFor', { name: template.name })}
                  menu={menu(template)}
                />
              </span>
            </li>
          </RowContextMenu>
        ))}
      </ul>
      {renaming && (
        <RenameDialog key={renaming.id} template={renaming} onClose={() => setRenaming(null)} />
      )}
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
  return translate('dynamicClient', {
    data: data,
    value2: data === 1 ? translate('dynamicField') : translate('dynamicFields'),
  })
}

/** A new name for a template: saved with everything else as it is. */
function RenameDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const [name, setName] = useState(template.name)
  const [error, setError] = useState<string | undefined>()
  const save = useTemplateMutation((next: string) => {
    const body = templateInput(template, next)
    if (!body) throw new Error(`template ${template.id} has no PDF`)
    return templatesApi.update(template.id, body)
  })
  return (
    <FormDialog
      title={translate('renameTemplate')}
      description={template.name}
      action={translate('save').trim()}
      pending={save.isPending}
      onClose={onClose}
      onSubmit={() => {
        const next = name.trim()
        if (!next) return setError(translate('enterAName'))
        if (next === template.name) return onClose()
        save.mutate(next, {
          onSuccess: () => {
            toast.success(translate('templateRenamed'))
            onClose()
          },
          onError: toastError,
        })
      }}
    >
      <FormField id="template-name" label={translate('name')} required error={error}>
        <input
          {...describedBy('template-name', error)}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
      </FormField>
    </FormDialog>
  )
}

/** A template's actions, for its "…" button and its right-click menu. */
function templateMenu(
  template: Template,
  on: {
    onFill: (template: Template) => void
    onEdit: (template: Template) => void
    onRename: (template: Template) => void
    onDuplicate: (template: Template) => void
    onDelete: (template: Template) => void
    duplicating: boolean
  },
): RowMenuSpec {
  return {
    title: template.name,
    items: ({ Item, Separator }) => {
      const noPdf = !template.document
      const why = noPdf ? translate('itsPDFWasDeletedChooseAnotherInTheEditor') : undefined
      return (
        <>
          <Item disabled={noPdf} onSelect={() => on.onFill(template)}>
            <FilePen />
            <MenuText label={translate('useTemplate')} why={why} />
          </Item>
          <Item onSelect={() => on.onEdit(template)}>
            <Pencil />
            {translate('editTemplate')}
          </Item>
          <Item disabled={noPdf} onSelect={() => on.onRename(template)}>
            <TextCursorInput />
            <MenuText label={translate('renameTemplate')} why={why} />
          </Item>
          <Item disabled={noPdf || on.duplicating} onSelect={() => on.onDuplicate(template)}>
            <Copy />
            <MenuText label={translate('duplicateTemplate')} why={why} />
          </Item>
          <Item disabled={noPdf} asChild={!noPdf}>
            {template.document ? (
              <a href={localizedHref(downloadUrl(template.document.id))} download>
                <FileDown />
                {translate('downloadSourcePDF')}
              </a>
            ) : (
              <>
                <FileDown />
                <MenuText label={translate('downloadSourcePDF')} why={why} />
              </>
            )}
          </Item>
          <Separator />
          <Item variant="destructive" onSelect={() => on.onDelete(template)}>
            <Trash2 />
            {translate('delete')}
          </Item>
        </>
      )
    },
  }
}
