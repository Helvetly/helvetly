/**
 * The one look of every segmented control (Tabs' default list, `Segmented`, view and option switchers): a soft
 * grey track and, for the chosen segment, a lifted white pill with near-black semibold text. The chosen state is
 * the `segment-on` variant (`globals.css`), so tabs (`data-state`), toggle buttons (`aria-pressed`) and radio
 * labels share it. The callers pick the display (`inline-flex`, `grid`) and, where a field sits beside it, the height.
 */
export const segmentTrack = 'items-stretch rounded-xl bg-muted p-1'

export const segmentItem =
  'relative inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground ' +
  'focus-visible:ring-2 focus-visible:ring-ring/50 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ' +
  'segment-on:border-border segment-on:bg-card segment-on:font-semibold segment-on:text-foreground segment-on:shadow-[0_1px_2px_rgb(0_0_0/0.06),0_1px_1px_rgb(0_0_0/0.03)] dark:segment-on:border-white/8 dark:segment-on:bg-white/10 ' +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/**
 * A label's text that keeps the width of its semibold self, so choosing a segment never moves its neighbours.
 * The bold copy is generated content with empty alternative text: neither read out nor found as text.
 */
export const segmentText =
  "inline-flex flex-col items-center after:pointer-events-none after:invisible after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-text)_/_''] after:select-none"
