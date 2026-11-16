'use client'

import { createContext, type ReactNode, use } from 'react'

import { translate } from '@/lib/i18n'
import { type Offer, useOffer } from '@/lib/offer'

const OfferContext = createContext<Offer | null>(null)

/** Asks the API for the offer once for everything inside that shows prices. */
export function OfferProvider({ children }: { children: ReactNode }) {
  const offer = useOffer() // memoised: changes only with the status
  return <OfferContext value={offer}>{children}</OfferContext>
}

export function useOfferStatus(): Offer {
  const offer = use(OfferContext)
  if (!offer) throw new Error('useOfferStatus needs an OfferProvider around it')
  return offer
}

/** A price from plans.ts, shown while the API has not refused it, as on the pricing page. */
export function OfferPrice({ children }: { children: ReactNode }) {
  return useOfferStatus().status === 'unavailable' ? translate('priceUnavailable') : children
}
