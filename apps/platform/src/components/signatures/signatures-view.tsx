'use client'
import { localizedHref } from '@helvetly/i18n'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { formatRelative } from '@helvetly/ui/lib/format'
import { cn } from '@helvetly/ui/lib/utils'
import { Ban, BellRing, FileDown, FileSignature, FolderOpen, PanelRightOpen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { toastError } from '@/components/billing/upgrade-prompt'
import { LoadProblem } from '@/components/data/load-problem'
import { RowContextMenu, RowMenuButton, type RowMenuSpec } from '@/components/data/menus'
import { LoadingRows, State } from '@/components/data/table-page'
import { initialsOf } from '@/components/initials'
import { downloadUrl } from '@/lib/documents'
import { translate } from '@/lib/i18n'
import {
  originalUrl,
  progressOf,
  remindTargets,
  signaturesApi,
  useSignatureMutation,
  signerColor,
  useSignatureRequests,
  type RequestStatus,
  type SignatureRequest,
} from '@/lib/signatures'

import { RequestBadge } from './parts'

const FILTERS: [RequestStatus | null, string][] = [
  [null, translate('all')],
  ['pending', translate('outForSignature')],
  ['completed', translate('completed')],
  ['declined', translate('declined')],
  ['expired', translate('expired')],
  ['revoked', translate('revoked')],
]

/** Last thing that happened to a request, for sorting by eye. */
const touched = (request: SignatureRequest) =>
  [
    request.completed_at,
    ...request.signers.flatMap((s) => [s.signed_at, s.declined_at, s.viewed_at, s.sent_at]),
    request.created_at,
  ]
    .filter((at): at is string => at !== null)
    .toSorted()
    .at(-1) ?? request.created_at

/** The Signatures section of Documents: every request of the workspace, newest first. */
export function SignaturesView({
  onOpen,
  onShowDocument,
}: {
  onOpen: (id: string) => void
  /** Shows the request's PDF (the signed one once there is one) in its Documents folder. */
  onShowDocument: (request: SignatureRequest, documentId: string) => void
}) {
  const [status, setStatus] = useState<RequestStatus | null>(null)
  const [revoking, setRevoking] = useState<SignatureRequest | null>(null)
  const list = useSignatureRequests(status)
  const requests = list.data ?? []
  const remind = useSignatureMutation(signaturesApi.remind)
  const revoke = useSignatureMutation(signaturesApi.revoke)

  const menu = (request: SignatureRequest) =>
    requestMenu(request, {
      onOpen,
      onShowDocument,
      onRevoke: setRevoking,
      reminding: remind.isPending,
      onRemind: (id) =>
        remind.mutate(id, {
          onSuccess: () => toast.success(translate('reminderSentWithAFreshLink')),
          onError: toastError,
        }),
    })

  return (
    <div className="flex flex-1 flex-col">
      <div
        role="tablist"
        aria-label={translate('filterByStatus')}
        className="flex gap-1 overflow-x-auto px-3 pt-3 md:px-5"
      >
        {FILTERS.map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => setStatus(value)}
            className="h-8 shrink-0 cursor-pointer rounded-full px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground aria-selected:bg-foreground/[0.07] aria-selected:font-medium aria-selected:text-foreground"
          >
            {label}
          </button>
        ))}
      </div>
      {list.error ? (
        <LoadProblem
          error={list.error}
          what={translate('theSignatureRequests')}
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <LoadingRows />
      ) : requests.length === 0 ? (
        <State
          icon={<FileSignature />}
          title={status ? translate('nothingHere') : translate('nothingOutForSignature')}
          text={
            status ? translate('noRequestHasThisStatus') : translate('sendAPDFToSignOnlineOrMakeA')
          }
        />
      ) : (
        <ul className="grid px-2 py-2 md:px-3">
          {requests.map((request) => (
            <RowContextMenu key={request.id} menu={menu(request)}>
              <li className="group/row relative rounded-xl">
                <Row request={request} onOpen={() => onOpen(request.id)} />
                <span className="absolute top-1/2 right-3 -translate-y-1/2">
                  <RowMenuButton
                    label={translate('moreFor', { name: request.title })}
                    menu={menu(request)}
                  />
                </span>
              </li>
            </RowContextMenu>
          ))}
        </ul>
      )}
      {revoking && (
        <ConfirmDialog
          tone="destructive"
          title={translate('revokeThisRequest')}
          body={translate('everySigningLinkStopsWorkingAtOnceSignaturesAlready')}
          confirmLabel={translate('revoke')}
          cancelLabel={translate('cancel')}
          onDecide={(confirmed) => {
            const target = revoking
            setRevoking(null)
            if (confirmed)
              revoke.mutate(target.id, {
                onSuccess: () => toast.success(translate('requestRevoked')),
                onError: toastError,
              })
          }}
        />
      )}
    </div>
  )
}

function Row({ request, onOpen }: { request: SignatureRequest; onOpen: () => void }) {
  const { signed, total } = progressOf(request)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-3 pr-14 text-left transition-colors hover:bg-foreground/[0.035] md:grid-cols-[minmax(0,1fr)_150px_150px_110px]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-section-icon-surface text-section-icon">
          <FileSignature className="size-[18px] stroke-[1.5]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px]">{request.title}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {request.document?.name ?? translate('originalKeptWithTheRequest')}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2 max-md:hidden">
        <span className="flex -space-x-1.5">
          {request.signers.slice(0, 4).map((signer, index) => (
            <span
              key={signer.id}
              title={`${signer.name} · ${signer.status}`}
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-[9.5px] font-semibold ring-2 ring-card',
                signer.status === 'signed' ? 'text-white' : 'bg-card',
              )}
              style={
                signer.status === 'signed'
                  ? { backgroundColor: signerColor(index) }
                  : {
                      color: signerColor(index),
                      boxShadow: `inset 0 0 0 1.5px ${signerColor(index)}`,
                    }
              }
            >
              {initialsOf(signer.name)}
            </span>
          ))}
        </span>
        <span className="text-[12.5px] text-muted-foreground tabular-nums">
          {signed}/{total}
        </span>
      </span>
      <span className="max-md:col-start-2 max-md:row-start-1 md:justify-self-start">
        <RequestBadge status={request.status} />
      </span>
      <span className="text-[12.5px] text-muted-foreground max-md:hidden">
        {formatRelative(touched(request))}
      </span>
    </button>
  )
}

/** A request's actions, for its "…" button and its right-click menu; those that change it only while pending. */
function requestMenu(
  request: SignatureRequest,
  on: {
    onOpen: (id: string) => void
    onShowDocument: (request: SignatureRequest, documentId: string) => void
    onRemind: (id: string) => void
    onRevoke: (request: SignatureRequest) => void
    reminding: boolean
  },
): RowMenuSpec {
  const pending = request.status === 'pending'
  const notPending = pending ? undefined : translate('onlyWhileWaitingForSignatures')
  const shown = request.signed_document ?? request.document
  return {
    header: request.title,
    actions: [
      {
        id: 'open',
        group: 'view',
        icon: <PanelRightOpen />,
        label: translate('open'),
        onSelect: () => on.onOpen(request.id),
      },
      {
        id: 'download',
        group: 'view',
        icon: <FileDown />,
        label: request.signed_document
          ? translate('downloadSignedPDF')
          : translate('downloadOriginalPDF'),
        href: localizedHref(
          request.signed_document
            ? downloadUrl(request.signed_document.id)
            : originalUrl(request.id),
        ),
        download: true,
      },
      {
        id: 'documents',
        group: 'view',
        icon: <FolderOpen />,
        label: translate('openInDocuments'),
        onSelect: () => shown && on.onShowDocument(request, shown.id),
        disabled: !shown,
        disabledReason: shown ? undefined : translate('itsFileIsNoLongerInDocuments'),
      },
      // Only while someone is still waiting for it, as the request's drawer shows it.
      ...(remindTargets(request).length
        ? [
            {
              id: 'remind',
              group: 'send' as const,
              icon: <BellRing />,
              label: translate('sendReminder'),
              onSelect: () => on.onRemind(request.id),
              disabled: on.reminding,
            },
          ]
        : []),
      {
        id: 'revoke',
        group: 'danger',
        icon: <Ban />,
        label: translate('revoke'),
        onSelect: () => on.onRevoke(request),
        disabled: !pending,
        disabledReason: notPending,
      },
    ],
  }
}
