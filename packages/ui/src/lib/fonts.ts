import { Geist_Mono, Inter } from 'next/font/google'

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

// The fonts on <html>: shared by every Next.js app and by Storybook, so stories render in Inter too.
export const fontClassName = ['font-sans', 'antialiased', sans.variable, mono.variable].join(' ')
