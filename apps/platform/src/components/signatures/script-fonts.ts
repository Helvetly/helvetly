import {
  Alex_Brush,
  Allura,
  Caveat,
  Dancing_Script,
  Great_Vibes,
  Herr_Von_Muellerhoff,
  Kalam,
  La_Belle_Aurore,
  Mr_Dafoe,
  Parisienne,
  Sacramento,
  Yellowtail,
} from 'next/font/google'

// next/font downloads these at build time and serves them from our own origin: no font CDN at runtime. Without
// preloading, the browser fetches a font's file only once text in it is shown (the open list, the preview), and only
// the unicode ranges that text needs. Every one has latin-ext, for names such as Müller, Gärtner or Łukasz. All are
// under the SIL Open Font License.
const dancing = Dancing_Script({ preload: false, weight: '500', display: 'block' })
const greatVibes = Great_Vibes({ preload: false, weight: '400', display: 'block' })
const caveat = Caveat({ preload: false, weight: '500', display: 'block' })
const allura = Allura({ preload: false, weight: '400', display: 'block' })
const sacramento = Sacramento({ preload: false, weight: '400', display: 'block' })
const alexBrush = Alex_Brush({ preload: false, weight: '400', display: 'block' })
const kalam = Kalam({ preload: false, weight: '400', display: 'block' })
const yellowtail = Yellowtail({ preload: false, weight: '400', display: 'block' })
const mrDafoe = Mr_Dafoe({ preload: false, weight: '400', display: 'block' })
const laBelleAurore = La_Belle_Aurore({ preload: false, weight: '400', display: 'block' })
const herrVonMuellerhoff = Herr_Von_Muellerhoff({ preload: false, weight: '400', display: 'block' })
const parisienne = Parisienne({ preload: false, weight: '400', display: 'block' })

/** The handwriting styles a typed signature can take, named after their fonts; the first is the default. */
export const SCRIPT_FONTS = [
  { id: 'dancing', label: 'Dancing Script', family: dancing.style.fontFamily },
  { id: 'great-vibes', label: 'Great Vibes', family: greatVibes.style.fontFamily },
  { id: 'caveat', label: 'Caveat', family: caveat.style.fontFamily },
  { id: 'allura', label: 'Allura', family: allura.style.fontFamily },
  { id: 'sacramento', label: 'Sacramento', family: sacramento.style.fontFamily },
  { id: 'alex-brush', label: 'Alex Brush', family: alexBrush.style.fontFamily },
  { id: 'kalam', label: 'Kalam', family: kalam.style.fontFamily },
  { id: 'yellowtail', label: 'Yellowtail', family: yellowtail.style.fontFamily },
  { id: 'mr-dafoe', label: 'Mr Dafoe', family: mrDafoe.style.fontFamily },
  { id: 'la-belle-aurore', label: 'La Belle Aurore', family: laBelleAurore.style.fontFamily },
  {
    id: 'herr-von-muellerhoff',
    label: 'Herr Von Muellerhoff',
    family: herrVonMuellerhoff.style.fontFamily,
  },
  { id: 'parisienne', label: 'Parisienne', family: parisienne.style.fontFamily },
] as const
