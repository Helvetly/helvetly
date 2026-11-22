/** Gaps in the page list (pages left out), named apart so each keeps its own key. */
type Gap = 'gap-start' | 'gap-end'

const SLOTS = 7

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

/**
 * The pages a pager shows for `page` of `pages`: the first, the last, the current one with its
 * neighbours, and gaps between; always seven slots once there are more pages, so the pager never
 * changes width while paging (1 2 3 4 5 … 20, 1 … 9 10 11 … 20, 1 … 16 17 18 19 20).
 */
export function pageItems(page: number, pages: number): Array<number | Gap> {
  if (pages <= SLOTS) return range(1, pages)
  if (page <= 4) return [...range(1, 5), 'gap-end', pages]
  if (page >= pages - 3) return [1, 'gap-start', ...range(pages - 4, pages)]
  return [1, 'gap-start', page - 1, page, page + 1, 'gap-end', pages]
}
