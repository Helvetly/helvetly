import { Caveat, Dancing_Script, Homemade_Apple } from 'next/font/google'

// next/font downloads these at build time and serves them from our own origin: no font CDN at runtime.
const dancing = Dancing_Script({ subsets: ['latin', 'latin-ext'], weight: '500', display: 'block' })
const caveat = Caveat({ subsets: ['latin', 'latin-ext'], weight: '500', display: 'block' })
const homemade = Homemade_Apple({ subsets: ['latin'], weight: '400', display: 'block' })

/** The handwriting styles a typed signature can take. */
export const SCRIPT_FONTS = [
  { id: 'dancing', label: 'Flowing', family: dancing.style.fontFamily },
  { id: 'caveat', label: 'Natural', family: caveat.style.fontFamily },
  { id: 'homemade', label: 'Personal', family: homemade.style.fontFamily },
] as const
