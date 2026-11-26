import { Caveat, Dancing_Script, Homemade_Apple } from 'next/font/google'

import { translate } from '@/lib/i18n'

// next/font downloads these at build time and serves them from our own origin: no font CDN at runtime.
const dancing = Dancing_Script({ preload: false, weight: '500', display: 'block' })
const caveat = Caveat({ preload: false, weight: '500', display: 'block' })
const homemade = Homemade_Apple({ preload: false, weight: '400', display: 'block' })

/** The handwriting styles a typed signature can take. */
export const SCRIPT_FONTS = [
  { id: 'dancing', label: translate('flowing'), family: dancing.style.fontFamily },
  { id: 'caveat', label: translate('natural'), family: caveat.style.fontFamily },
  { id: 'homemade', label: translate('personal'), family: homemade.style.fontFamily },
] as const
