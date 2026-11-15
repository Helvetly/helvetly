'use client'

import { translate } from '@/lib/i18n'
import type en from '@/messages/en.json'

export function PageTitle({ message }: { message: keyof typeof en }) {
  return <title>{`${translate(message)} · ${translate('clientPortal')}`}</title>
}
