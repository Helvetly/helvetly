'use client'
import { Badge } from '@helvetly/ui/components/badge'
import { formatDate } from '@helvetly/ui/lib/format'
import { STATUS_TONES } from '@helvetly/ui/lib/status-tones'
import { cn } from '@helvetly/ui/lib/utils'

import { translate } from '@/lib/i18n'
import { type PortalSignature, portalSignatureUrl } from '@/lib/portal'

import { cardClass, DownloadLink, FileTile, rowClass } from './portal-bits'

function badge(signature: PortalSignature) {
  if (signature.status === 'completed')
    return { tone: STATUS_TONES.signatureRequest.completed, label: translate('signatureSigned') }
  if (signature.status === 'declined')
    return { tone: STATUS_TONES.signatureRequest.declined, label: translate('signatureDeclined') }
  if (signature.status === 'expired')
    return { tone: STATUS_TONES.signatureRequest.expired, label: translate('signatureExpired') }
  return signature.awaiting_you
    ? { tone: STATUS_TONES.signer.viewed, label: translate('signatureToSign') }
    : { tone: STATUS_TONES.signatureRequest.pending, label: translate('signatureAwaitingOthers') }
}

function detail(signature: PortalSignature) {
  if (signature.status === 'completed' && signature.completed_at)
    return translate('signedOn', { date: formatDate(signature.completed_at) })
  if (signature.status === 'pending' && signature.awaiting_you)
    return translate('signWithTheLinkInYourEmail')
  return translate('sentOn', { date: formatDate(signature.sent_at) })
}

/** The documents sent to the client for signature: status, when, and the signed PDF once everyone signed. */
export function SignatureList({ signatures }: { signatures: PortalSignature[] }) {
  return (
    <ul className={cn(cardClass, 'grid divide-y overflow-hidden')}>
      {signatures.map((signature) => {
        const { tone, label } = badge(signature)
        return (
          <li key={signature.id} className={rowClass}>
            <FileTile contentType="application/pdf" />
            <span className="grid min-w-0 flex-1 gap-0.5 leading-tight">
              <span className="truncate text-body font-medium">{signature.title}</span>
              <span className="truncate text-body-sm text-muted-foreground">
                {detail(signature)}
              </span>
            </span>
            <Badge tone={tone} className="shrink-0">
              {label}
            </Badge>
            {signature.signed_file && (
              <DownloadLink
                href={portalSignatureUrl(signature.id)}
                label={translate('downloadSignedPdf', { name: signature.title })}
                text={translate('download')}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
