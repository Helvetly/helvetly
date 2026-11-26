import { pricePreview } from '@/components/products/product-form-model'
import {
  fromCents,
  parseDecimalInput,
  toCents,
  type CataloguePriceFields,
  type VatMode,
} from '@/lib/invoices'
import type { Product } from '@/lib/products'

import type { EditorLine } from './editor-model'

type CataloguePrice = Pick<Product, 'currency' | 'price_basis' | 'unit_price'>
export type CatalogueLine = { catalogue?: CataloguePrice; acceptedConversion?: boolean }

export function catalogueFields(line: EditorLine): CataloguePriceFields {
  const source = line.catalogue
  return source
    ? {
        catalogue_price_basis: source.price_basis,
        catalogue_unit_price: source.unit_price,
        catalogue_currency: source.currency,
      }
    : {}
}

export function savedCataloguePrice(
  basis: unknown,
  unit: unknown,
  currency: unknown,
): CatalogueLine {
  const price = typeof unit === 'string' ? parseDecimalInput(unit, 2, true) : null
  if (
    (basis !== 'net' && basis !== 'gross') ||
    !price ||
    price.startsWith('-') ||
    typeof currency !== 'string'
  )
    return {}
  return {
    catalogue: { price_basis: basis, unit_price: price, currency },
    acceptedConversion: true,
  }
}

const round = (n: bigint, d: bigint) => (2n * n + d) / (2n * d)

// Compare the line before document discounts and cash rounding. The invoice preview computes the document totals.
function catalogueConversion(line: EditorLine, mode: VatMode, currency: string) {
  const source = line.catalogue
  if (!source || source.currency !== currency || mode === 'none' || line.vat_category !== 'S')
    return null
  const basis = mode === 'inclusive' ? 'gross' : 'net'
  if (source.price_basis === basis) return null
  const qty = parseDecimalInput(line.quantity, 3, true)
  const discount = parseDecimalInput(line.discount_percent || '0', 2, true)
  if (
    !qty ||
    qty.startsWith('-') ||
    !discount ||
    discount.startsWith('-') ||
    toCents(discount) > 10000n
  )
    return null
  const factor = BigInt(qty.replace('.', '')) * (10000n - toCents(discount))

  const amounts = (price: string, price_basis: 'net' | 'gross') =>
    pricePreview({
      unit_price: fromCents(round(toCents(price) * factor, 10000000n)),
      price_basis,
      vat_category: line.vat_category,
      vat_rate: line.vat_rate,
    })
  const original = amounts(source.unit_price, source.price_basis)
  const perUnit = pricePreview({
    ...source,
    vat_category: line.vat_category,
    vat_rate: line.vat_rate,
  })
  if (!perUnit) return null
  let unitPrice = perUnit[basis]
  let projected = amounts(unitPrice, basis)
  if (!original || !projected) return null
  if (factor > 0n && projected.gross !== original.gross) {
    // Fractional quantities and discounts can make another cent price represent the exact line total.
    const target = toCents(original[basis])
    // Find the closest unit price whose discounted line rounds to the target cent.
    const divisor = 2n * factor
    const min = ((2n * target - 1n) * 10000000n + divisor - 1n) / divisor
    const max = ((2n * target + 1n) * 10000000n - 1n) / divisor
    const current = toCents(unitPrice)
    const candidate = fromCents(current < min ? min : current > max ? max : current)
    const alternate = amounts(candidate, basis)
    if (alternate?.gross === original.gross) {
      unitPrice = candidate
      projected = alternate
    }
  }
  return {
    unitPrice,
    original: original.gross,
    projected: projected.gross,
    difference: fromCents(toCents(projected.gross) - toCents(original.gross)),
  }
}

export function priceCatalogueLine(line: EditorLine, mode: VatMode, currency: string): EditorLine {
  const source = line.catalogue
  if (!source || mode === 'none' || source.currency !== currency) return line
  const conversion = catalogueConversion(line, mode, currency)
  return {
    ...line,
    acceptedConversion: false,
    unit_price: conversion?.unitPrice ?? source.unit_price,
  }
}

export function unresolvedCataloguePrice(line: EditorLine, mode: VatMode, currency: string) {
  if (line.acceptedConversion) return null
  const conversion = catalogueConversion(line, mode, currency)
  return conversion && conversion.original !== conversion.projected ? conversion : null
}

export function catalogueSource(product: Product): CataloguePrice {
  const { currency, price_basis, unit_price } = product
  return { currency, price_basis, unit_price }
}
