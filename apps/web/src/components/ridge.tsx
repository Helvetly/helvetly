import { cn } from '@/lib/cn'

// The alpine ridge from the logo, across the full width, where a light section meets a night one.
// `rise` sits above a night section: its peaks rise into the page. `fall` sits below one: the page's
// own colour comes back as peaks rising into the night. Three layers give the range depth.

// A natural ridge: big peaks from `peaks`, each slope broken by small deterministic shoulders.
function ridge(peaks: [number, number][], seed: number): string {
  let d = `M0 160V${peaks[0]![1]}`
  for (let i = 1; i < peaks.length; i++) {
    const [x0, y0] = peaks[i - 1]!
    const [x1, y1] = peaks[i]!
    for (let s = 1; s <= 3; s++) {
      const t = s / 4
      const wobble = (((i * 7 + s * 13 + seed) % 9) - 4) * 2.2
      d += `L${Math.round(x0 + (x1 - x0) * t)} ${Math.round(y0 + (y1 - y0) * t + wobble)}`
    }
    d += `L${x1} ${y1}`
  }
  return `${d}V160Z`
}

const FAR = ridge(
  [
    [0, 70],
    [150, 40],
    [300, 76],
    [470, 14],
    [640, 64],
    [800, 30],
    [980, 72],
    [1130, 8],
    [1300, 58],
    [1460, 26],
    [1600, 54],
  ],
  1,
)
const MID = ridge(
  [
    [0, 96],
    [110, 74],
    [260, 102],
    [400, 52],
    [560, 92],
    [720, 60],
    [880, 104],
    [1020, 46],
    [1190, 94],
    [1350, 64],
    [1500, 98],
    [1600, 80],
  ],
  4,
)
const NEAR = ridge(
  [
    [0, 124],
    [180, 100],
    [340, 130],
    [520, 96],
    [700, 128],
    [860, 104],
    [1060, 132],
    [1240, 98],
    [1420, 126],
    [1600, 108],
  ],
  7,
)

export function Ridge({ edge, className }: { edge: 'rise' | 'fall'; className?: string }) {
  const rise = edge === 'rise'
  return (
    <svg
      aria-hidden
      viewBox="0 0 1600 160"
      preserveAspectRatio="none"
      className={cn(
        'pointer-events-none absolute inset-x-0 h-14 w-full sm:h-40',
        rise ? 'bottom-[calc(100%-1px)]' : 'bottom-[-1px]',
        className,
      )}
    >
      <path d={FAR} className={rise ? 'fill-lilac' : 'fill-mint/25'} />
      <path d={MID} className={rise ? 'fill-lilac-solid/45' : 'fill-mint/55'} />
      <path d={NEAR} className={rise ? 'fill-night-2' : 'fill-site'} />
    </svg>
  )
}
