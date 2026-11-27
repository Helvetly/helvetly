'use client'
import { Combobox, type Option } from '@helvetly/ui/components/combobox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@helvetly/ui/components/tooltip'
import { formatDate } from '@helvetly/ui/lib/format'

import { FileIcon } from '@/components/import/import-files'
import { type DocFile, useDoc, useDocList } from '@/lib/documents'
import { translate } from '@/lib/i18n'

// shortcut: picks among the client's and the workspace's 50 latest documents, filtered by name in the list;
// search on the server once workspaces keep many more contracts than that.
const PAGE = '50'

const listQuery = (clientId?: string) =>
  new URLSearchParams({
    sort: '-updated_at',
    page_size: PAGE,
    ...(clientId && { client_id: clientId }),
  })

const option = (doc: DocFile, group: string): Option => ({
  value: doc.id,
  label: doc.name,
  hint: formatDate(doc.updated_at),
  group,
})

/** The engagement's contract: a document from Documents, the client's first, or none. Stores the document's id. */
export function ContractDocumentField({
  id,
  value,
  clientId,
  invalid,
  onChange,
}: {
  id: string
  value: string
  clientId: string
  invalid?: boolean
  onChange: (documentId: string) => void
}) {
  const ofClient = useDocList(listQuery(clientId), Boolean(clientId))
  const recent = useDocList(listQuery())
  const clientDocs = clientId ? (ofClient.data?.data ?? []) : []
  const otherDocs = (recent.data?.data ?? []).filter((d) => !clientDocs.some((c) => c.id === d.id))
  const listed = [...clientDocs, ...otherDocs].some((d) => d.id === value)
  // A linked document outside the lists (older, or moved to the Trash) still shows by name, and stays linked.
  const linked = useDoc(value && !listed && recent.isSuccess ? value : null)

  const options: Option[] = [
    { value: '', label: translate('contractDocumentNone') },
    ...(value && !listed
      ? [{ value, label: linked.data?.name ?? translate('contractDocumentLinked') }]
      : []),
    ...clientDocs.map((d) => option(d, translate('contractDocumentOfClient'))),
    ...otherDocs.map((d) =>
      option(d, clientDocs.length ? translate('contractDocumentOther') : translate('documents')),
    ),
  ]
  const pending = recent.isPending || (Boolean(clientId) && ofClient.isPending)
  const empty = recent.isSuccess && (!clientId || ofClient.isSuccess) && options.length === 1

  return (
    <div className="grid min-w-0 gap-1.5">
      <Combobox
        id={id}
        value={value}
        options={options}
        onChange={onChange}
        placeholder={pending ? translate('loading') : translate('contractDocumentNone')}
        invalid={invalid}
        disabled={empty}
        searchable
        contentClassName="w-[min(26rem,calc(100vw-2rem))]"
        renderValue={(picked) =>
          picked.value ? (
            // A long file name ends in an ellipsis inside the field; the whole name shows on hover.
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex min-w-0 items-center gap-1.5">
                  <FileIcon name={picked.label} className="size-3.5 shrink-0" />
                  <span className="truncate">{picked.label}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{picked.label}</TooltipContent>
            </Tooltip>
          ) : (
            picked.label
          )
        }
      />
      {empty && (
        <p className="text-xs text-muted-foreground">{translate('contractDocumentNoneYet')}</p>
      )}
    </div>
  )
}
