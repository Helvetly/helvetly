import { StatusBadge } from '@helvetly/ui/components/status-badge'

import { formatAmount, UNITS, VAT_CATEGORIES } from '@/lib/invoices'
import type { Product } from '@/lib/products'

export function ProductTypeBadge({ type }: { type: Product['type'] }) {
  return type === 'product' ? (
    <StatusBadge tone="blue">Product</StatusBadge>
  ) : (
    <StatusBadge tone="green">Service</StatusBadge>
  )
}

export const ArchivedBadge = () => <StatusBadge tone="amber">Archived</StatusBadge>

/** "h", "pcs" … for a price "per unit"; nothing without a unit. */
export const unitShort = (unit: Product['unit']) =>
  UNITS.find((entry) => entry.value === unit)?.short ?? null

export const unitLabel = (unit: Product['unit']) =>
  UNITS.find((entry) => entry.value === unit)?.label ?? null

/** "8.1 %" for standard-rated items, the category's name otherwise. */
export const vatLabel = (product: Pick<Product, 'vat_category' | 'vat_rate'>) =>
  product.vat_category === 'S'
    ? `${product.vat_rate} %`
    : (VAT_CATEGORIES.find((entry) => entry.value === product.vat_category)?.label ??
      product.vat_category)

/** The entered price, e.g. "150.00", and whether it is net or gross. */
export const enteredPrice = (product: Product) => formatAmount(product.unit_price)
