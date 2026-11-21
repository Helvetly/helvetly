import { Geist_Mono, Instrument_Serif, Inter } from 'next/font/google'

const sans = Inter({ subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-sans' })
const mono = Geist_Mono({ subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-mono' })
// The serif for an accent word in a headline (`.accent` in globals.css).
const serif = Instrument_Serif({
  subsets: ['latin'],
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
