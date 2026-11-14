import type { HeidiEvent } from '@/lib/heidi'

/** A step of a scripted answer: an event, sent after `wait` ms. */
export type Step = { event: HeidiEvent; wait: number }

export const words = (text: string, wait = 22): Step[] =>
  (text.match(/\S+\s*|\s+/g) ?? []).map((value) => ({ event: { type: 'text', value }, wait }))
export const status = (label: string, wait = 650): Step => ({
  event: { type: 'status', label },
  wait,
})
export const lines = (text: string): Step[] =>
  text.split('\n').map((line) => ({ event: { type: 'text', value: `${line}\n` }, wait: 70 }))
export const done = (tokens: number): Step => ({
  event: { type: 'done', usage: { tokens } },
  wait: 40,
})
