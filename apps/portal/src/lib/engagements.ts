import type { PortalEngagement } from '@/lib/portal'

/** What share of the current period is used: 0.4 for 4 of 10, above 1 past the limit. */
export const usedShare = ({ quantity, current_period }: PortalEngagement) =>
  current_period && Number(quantity) > 0 ? Number(current_period.used) / Number(quantity) : 0

/** Still to draw on; ended, cancelled, expired and used-up ones are on the Past tab. */
export const isActive = (engagement: PortalEngagement) => engagement.status === 'active'

/**
 * The engagement the overview's usage card is about. Rule: the one closest to its limit (highest used share), and
 * among equals the one whose period ends soonest, since that is where the client may need to act first.
 */
export const mostRelevant = (engagements: PortalEngagement[]) =>
  engagements
    .filter((engagement) => isActive(engagement) && engagement.current_period)
    .toSorted(
      (a, b) =>
        usedShare(b) - usedShare(a) ||
        (a.current_period?.ends_on ?? '').localeCompare(b.current_period?.ends_on ?? ''),
    )[0]
