// The site's six pastel tones (site.css), one per product area, as full class names so Tailwind sees them.
export type Tone = 'mint' | 'sky' | 'lilac' | 'peach' | 'lemon' | 'rose'

export const TONES: Record<
  Tone,
  { surface: string; ink: string; solid: string; dot: string; tile: string; border: string }
> = {
  mint: {
    surface: 'bg-mint',
    ink: 'text-mint-ink',
    solid: 'bg-mint-solid',
    dot: 'bg-mint-solid',
    tile: 'bg-linear-to-br from-mint via-mint/40 to-site',
    border: 'border-mint-solid/20',
  },
  sky: {
    surface: 'bg-sky',
    ink: 'text-sky-ink',
    solid: 'bg-sky-solid',
    dot: 'bg-sky-solid',
    tile: 'bg-linear-to-br from-sky via-sky/40 to-site',
    border: 'border-sky-solid/20',
  },
  lilac: {
    surface: 'bg-lilac',
    ink: 'text-lilac-ink',
    solid: 'bg-lilac-solid',
    dot: 'bg-lilac-solid',
    tile: 'bg-linear-to-br from-lilac via-lilac/40 to-site',
    border: 'border-lilac-solid/20',
  },
  peach: {
    surface: 'bg-peach',
    ink: 'text-peach-ink',
    solid: 'bg-peach-solid',
    dot: 'bg-peach-solid',
    tile: 'bg-linear-to-br from-peach via-peach/40 to-site',
    border: 'border-peach-solid/20',
  },
  lemon: {
    surface: 'bg-lemon',
    ink: 'text-lemon-ink',
    solid: 'bg-lemon-solid',
    dot: 'bg-lemon-solid',
    tile: 'bg-linear-to-br from-lemon via-lemon/40 to-site',
    border: 'border-lemon-solid/25',
  },
  rose: {
    surface: 'bg-rose',
    ink: 'text-rose-ink',
    solid: 'bg-rose-solid',
    dot: 'bg-rose-solid',
    tile: 'bg-linear-to-br from-rose via-rose/40 to-site',
    border: 'border-rose-solid/20',
  },
}
