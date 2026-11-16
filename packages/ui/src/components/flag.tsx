/** A small country flag, or nothing for an unsupported region. */
export function Flag({ region, className }: { region: string; className?: string }) {
  if (region === 'CH') {
    return (
      <svg aria-hidden viewBox="0 0 32 32" className={className}>
        <rect width="32" height="32" className="fill-flag-swiss-red" />
        <path d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z" className="fill-white" />
      </svg>
    )
  }
  if (region === 'GB') {
    // The Union Jack cropped to the middle; at this size the counterchanged diagonals are not visible.
    return (
      <svg aria-hidden viewBox="10 0 40 30" className={className}>
        <rect width="60" height="30" className="fill-flag-uk-blue" />
        <path d="M0 0l60 30M60 0L0 30" className="stroke-white" strokeWidth="6" />
        <path d="M0 0l60 30M60 0L0 30" className="stroke-flag-uk-red" strokeWidth="2" />
        <path d="M30 0v30M0 15h60" className="stroke-white" strokeWidth="10" />
        <path d="M30 0v30M0 15h60" className="stroke-flag-uk-red" strokeWidth="6" />
      </svg>
    )
  }
  if (region === 'DE') {
    return (
      <svg aria-hidden viewBox="0 0 30 20" className={className}>
        <rect width="30" height="20" className="fill-flag-german-gold" />
        <rect width="30" height="13.333" className="fill-flag-german-red" />
        <rect width="30" height="6.667" className="fill-black" />
      </svg>
    )
  }
  if (region === 'FR' || region === 'IT') {
    return (
      <svg aria-hidden viewBox="0 0 30 20" className={className}>
        <rect width="30" height="20" className="fill-white" />
        <rect
          width="10"
          height="20"
          className={region === 'FR' ? 'fill-flag-french-blue' : 'fill-flag-italian-green'}
        />
        <rect
          x="20"
          width="10"
          height="20"
          className={region === 'FR' ? 'fill-flag-french-red' : 'fill-flag-italian-red'}
        />
      </svg>
    )
  }
  return null
}
