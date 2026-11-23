import { translate } from '@/lib/i18n'
import type { PortalDocument } from '@/lib/portal'

/** A sent quote's PDF reads "Quote Q-2026-001", "Quote Q-2026-001 · Rev. 2"; any other document is its file name. */
export const documentTitle = ({ name, quote }: PortalDocument) =>
  quote
    ? translate('quoteTitle', {
        name: `${quote.number}${quote.revision > 1 ? translate('rev', { revision: quote.revision }) : ''}`,
      })
    : name
