/** `text` cut after `max` user-perceived characters (emoji and accents stay whole), with an ellipsis. */
export function shorten(text: string, max: number): string {
  const graphemes = Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment)
  return graphemes.length > max ? `${graphemes.slice(0, max).join('').trimEnd()}…` : text
}
export const initialsOf = (name: string) =>
  name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
