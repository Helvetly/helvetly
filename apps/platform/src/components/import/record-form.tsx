'use client'
import { ClientForm } from '@/components/clients/client-form'
import { EngagementForm } from '@/components/engagements/engagement-form'
import { FormSheetLoading, settled } from '@/components/form-sheet-loading'
import { ProductForm } from '@/components/products/product-form'
import { translate } from '@/lib/i18n'
import {
  IMPORT_KINDS,
  usePatchImportRecord,
  type ImportKind,
  type ImportKindConfig,
  type ImportRecord,
  type RecordChanges,
} from '@/lib/imports'
import { useInvoiceSettings } from '@/lib/invoices'

import type { FormImport } from './form-import'
import { RecordNotice } from './import-edit-drawer'

/** The kinds edited in their real entity form, with the fields that form may hand back to the import. */
const FORM_FIELDS = {
  clients: [
    'name',
    'preferred_name',
    'is_company',
    'email',
    'billing_email',
    'phone',
    'website',
    'street',
    'street_number',
    'apt',
    'zip',
    'city',
    'country',
    'vat_number',
    'registration_number',
    'language',
    'currency',
    'payment_terms_days',
    'note',
  ],
  products: [
    'type',
    'name',
    'description',
    'sku',
    'gtin',
    'unit',
    'price_basis',
    'unit_price',
    'currency',
    'vat_category',
    'vat_rate',
  ],
  engagements: [
    'client_id',
    'title',
    'description',
    'unit',
    'quantity',
    'unit_price',
    'overage_unit_price',
    'price_basis',
    'currency',
    'vat_category',
    'vat_rate',
    'billing',
    'recurrence',
    'interval',
    'start_date',
    'end_date',
    'reference',
  ],
} satisfies Partial<Record<ImportKind, string[]>>

export const editsInForm = (kind: ImportKind): kind is keyof typeof FORM_FIELDS =>
  kind in FORM_FIELDS

/** The form's input as a PATCH body: only the record's fields, an empty value cleared with null. */
export function inputChanges(input: object, fields: readonly string[]): RecordChanges {
  const changes: RecordChanges = {}
  for (const [field, value] of Object.entries(input)) {
    if (!fields.includes(field)) continue
    if (typeof value === 'string') changes[field] = value.trim() === '' ? null : value
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      changes[field] = value
  }
  return changes
}

/**
 * An import record edited in the real form of its kind: the same sections, choices and checks as creating one by
 * hand, prefilled from the document. Save updates the import row; the record is created only by Import.
 */
export function RecordForm({
  batchId,
  record,
  name,
  fileName,
  onDone,
}: {
  batchId: string
  record: ImportRecord & { kind: keyof typeof FORM_FIELDS }
  name: string
  fileName?: string
  onDone: (record: ImportRecord | null) => void
}) {
  const patch = usePatchImportRecord(batchId)
  const config: ImportKindConfig = IMPORT_KINDS[record.kind]
  const prefix = { clients: 'client', products: 'product', engagements: 'engagement' }[record.kind]
  const importing: FormImport = {
    data: record.data,
    issues: record.issues,
    name,
    notice: (
      <RecordNotice
        record={record}
        fileName={fileName}
        labelOf={(field) => config.fields[field] ?? field}
        focusId={(field) => `${prefix}-${field}`}
      />
    ),
    submit: async (input) => {
      const saved = await patch.mutateAsync({
        recordId: record.id,
        data: inputChanges(input, FORM_FIELDS[record.kind]),
      })
      if (!Object.keys(saved.issues).length) onDone(saved)
      return saved.issues
    },
  }
  const close = () => onDone(null)
  switch (record.kind) {
    case 'clients':
      return <ClientForm importing={importing} onClose={close} onSaved={close} />
    case 'products':
      return <ImportProductForm importing={importing} onClose={close} />
    case 'engagements':
      return <EngagementForm open onOpenChange={(open) => !open && close()} importing={importing} />
  }
}

/** The product form waits for the workspace's currency and VAT defaults, as it does for a new item. */
function ImportProductForm({ importing, onClose }: { importing: FormImport; onClose: () => void }) {
  const settingsQuery = useInvoiceSettings()
  const settings = settingsQuery.data
  if (!settled(settingsQuery))
    return <FormSheetLoading title={translate('editRecord')} onClose={onClose} />
  return (
    <ProductForm
      importing={importing}
      defaults={{
        currency: settings?.currency ?? 'CHF',
        vat_registered: settings?.vat_registered ?? true,
        default_vat_rate: settings?.default_vat_rate ?? '8.1',
      }}
      onClose={onClose}
      onSaved={onClose}
    />
  )
}
