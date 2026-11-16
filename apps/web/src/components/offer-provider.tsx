'use client'

import { createContext, type ReactNode, use } from 'react'

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
