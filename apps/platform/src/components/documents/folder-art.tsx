import { cn } from '@helvetly/ui/lib/utils'
import { useId } from 'react'

import { translate } from '@/lib/i18n'

// One soft blue for every folder, as CSS variables the illustration and the small icon both read.
const FOLDER_TONE =
  '[--folder-back:#5d97e3] [--folder-top:#a9d1fb] [--folder-bottom:#6aa8ef] [--folder-ink:#4a8ae0] [--folder-fill:#d8e9fd] dark:[--folder-back:#3d6fbd] dark:[--folder-top:#86b8f2] dark:[--folder-bottom:#4d8ad8] dark:[--folder-ink:#8dbdfa] dark:[--folder-fill:rgb(96_160_240/0.24)]'

/**
 * The small folder of lists, the sidebar and pickers (16–32px): the big folder's back panel, tab and
 * gradient front in a few strokes. `open` tips the front forward (an open folder, a drop over it).
 */
export function FolderMark({ open, className }: { open?: boolean; className?: string }) {
  const front = `${useId()}-front`
  return (
    <svg aria-hidden viewBox="0 0 24 20" className={cn('shrink-0', FOLDER_TONE, className)}>
      <defs>
        <linearGradient id={front} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-top)" />
          <stop offset="1" stopColor="var(--folder-bottom)" />
        </linearGradient>
      </defs>
      <path
        d="M2 3.6A1.6 1.6 0 0 1 3.6 2h5.1a1.6 1.6 0 0 1 1.13.47l1.1 1.06h9.47A1.6 1.6 0 0 1 22 5.13V16.4a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 16.4Z"
        fill="var(--folder-back)"
      />
      <path
        d={
          open
            ? 'M3.4 8.6A1.6 1.6 0 0 1 5 7.2h17a1.2 1.2 0 0 1 1.17 1.45l-1.62 8.1A1.6 1.6 0 0 1 20 18H3.6A1.6 1.6 0 0 1 2 16.4Z'
            : 'M1.3 7.6A1.6 1.6 0 0 1 2.9 6h18.2a1.6 1.6 0 0 1 1.6 1.6l-.5 8.9A1.6 1.6 0 0 1 20.6 18H3.4a1.6 1.6 0 0 1-1.6-1.5Z'
        }
        fill={`url(#${front})`}
      />
      <path
        d={open ? 'M5 7.75h16.6' : 'M2.9 6.55h18.2'}
        stroke="#fff"
        strokeOpacity="0.7"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * A big glossy folder: a back panel with its tab, sheets peeking out when it holds files, and a
 * translucent front. Inside a `group/item`, hover tips the front forward and lifts the sheets.
 */
export function FolderArt({ full, className }: { full: boolean; className?: string }) {
  const uid = useId()
  const back = `${uid}-back`
  const front = `${uid}-front`
  const shine = `${uid}-shine`
  const motion = translate('transitionTransformDuration300EaseCubicBezier02')
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 96"
      className={cn('overflow-visible', FOLDER_TONE, className)}
    >
      <defs>
        <linearGradient id={back} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-back)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--folder-back)" />
        </linearGradient>
        <linearGradient id={front} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-top)" />
          <stop offset="1" stopColor="var(--folder-bottom)" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M10 12a6 6 0 0 1 6-6h25.5a6 6 0 0 1 4.3 1.8l4.4 4.4a6 6 0 0 0 4.3 1.8H104a6 6 0 0 1 6 6V80a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8Z"
        fill={`url(#${back})`}
      />
      {full && (
        <g
          className={cn(
            motion,
            'group-hover/item:-translate-y-1.5 group-data-drop-over/item:-translate-y-2.5',
          )}
        >
          <rect
            x="21"
            y="13"
            width="72"
            height="58"
            rx="4"
            transform="rotate(-4 57 45)"
            fill="#eef2f7"
          />
          <rect
            x="27"
            y="12"
            width="72"
            height="60"
            rx="4"
            transform="rotate(3 63 45)"
            fill="#fbfcfe"
          />
          <path
            d="M37 22h30M37 28h44M37 34h38"
            stroke="#c9d3df"
            strokeWidth="2"
            strokeLinecap="round"
            transform="rotate(3 63 45)"
          />
        </g>
      )}
      <g
        className={cn(
          motion,
          'origin-bottom group-hover/item:[transform:skewX(-3deg)_scaleY(0.95)] group-data-drop-over/item:[transform:skewX(-5deg)_scaleY(0.9)]',
        )}
      >
        <path
          d="M5 37a7 7 0 0 1 7-7h96a7 7 0 0 1 7 7l-2.6 43.4A8 8 0 0 1 104.4 88H15.6a8 8 0 0 1-8-7.6Z"
          fill={`url(#${front})`}
          fillOpacity="0.94"
        />
        <path
          d="M5 37a7 7 0 0 1 7-7h96a7 7 0 0 1 7 7l-2.6 43.4A8 8 0 0 1 104.4 88H15.6a8 8 0 0 1-8-7.6Z"
          fill={`url(#${shine})`}
        />
        <path d="M12 30.6h96" stroke="#fff" strokeOpacity="0.6" strokeLinecap="round" />
      </g>
    </svg>
  )
}
