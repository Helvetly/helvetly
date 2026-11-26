import { Geist_Mono, Instrument_Serif, Inter } from 'next/font/google'

// next/font preloads the listed subsets; the browser fetches other glyph ranges when used.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = Geist_Mono({ preload: false, variable: '--font-mono' })
// The serif for an accent word in a headline (`.accent` in globals.css).
const serif = Instrument_Serif({
  preload: false,
  weight: '400',
  style: 'italic',
  variable: '--font-serif',
})

// The fonts on <html>: shared by every Next.js app and by Storybook, so stories render in Inter too.
export const fontClassName = [
  'font-sans',
  'antialiased',
  sans.variable,
  mono.variable,
  serif.variable,
].join(' ')
