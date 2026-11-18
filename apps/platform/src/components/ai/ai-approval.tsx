'use client'
import { Button } from '@helvetly/ui/components/button'
import { Callout } from '@helvetly/ui/components/callout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { IconTile } from '@helvetly/ui/components/icon-tile'
import { Loader } from '@helvetly/ui/components/loader'
import { isCancelledError, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Clock,
  FolderInput,
  Globe,
  GraduationCap,
  History,
  Info,
  MessageSquare,
  Paperclip,
  Scale,
  ShieldOff,
  Sparkles,
  UserCheck,
  type LucideIcon,
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'

import { ApiError, errorMessage } from '@/lib/api'
import { consentKey, heidiApi, usageKey, type HeidiConsent, type HeidiUsage } from '@/lib/heidi'
import { translate } from '@/lib/i18n'
import { useSession } from '@/lib/queries'
import { siteUrl } from '@/lib/site'

type AIApproval = {
  /**
   * Call right before an explicit AI action. True: go ahead, once. False: the person said not now (or switched
   * workspace); send nothing and keep what they entered.
   */
  ensure: () => Promise<boolean>
}

// Outside the provider (isolated tests and stories) nothing asks; the server still refuses without approval.
// invoker: what had focus when the action asked; focus returns there when the dialog closes.
type Ask = { resolve: (approved: boolean) => void; identity: string; invoker: HTMLElement | null }

const Context = createContext<AIApproval>({ ensure: async () => true })

export const useAIApproval = () => useContext(Context)

/** The server refused because the person has not approved AI use in this workspace. */
export const isAIConsentRequired = (error: unknown) =>
  error instanceof ApiError && error.code === 'ai_consent_required'

/** The notice's texts come from the API; its point ids pick an icon, and a new id gets the default one. */
const ICONS: Record<string, LucideIcon> = {
  messages: MessageSquare,
  files: Paperclip,
  filing: FolderInput,
  name: Building2,
  hr: ShieldOff,
  training: GraduationCap,
  retention: Clock,
  history: History,
  provider: Globe,
  scope: UserCheck,
  legal: Scale,
}

const isVersionChanged = (error: unknown) =>
  error instanceof ApiError && error.code === 'ai_consent_version_changed'

/**
 * Asks each person once per workspace, before their first AI use (Heidi, AI import, receipt reading), whether
 * content may go to the AI model. Their own approval only: any role, nobody approves for anyone else.
 */
export function AIApprovalProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const session = useSession().data
  const identity = session ? `${session.user.id}:${session.workspace.id}` : ''
  const current = useRef(identity)
  const checking = useRef(false) // one ensure() at a time, from its first await to its answer
  const pending = useRef<Ask | null>(null)
  const [open, setOpen] = useState(false)
  // The notice changed between showing it and approving: shown again, with a line that says so.
  const [changed, setChanged] = useState(false)
  // Read afresh each time the question opens, so the approval names the version the person sees.
  const notice = useQuery({
    queryKey: consentKey,
    queryFn: heidiApi.consent,
    enabled: open,
    staleTime: 0,
  })
  const returnFocus = useRef<HTMLElement | null>(null)

  /** Answers ask, unless a newer question or another identity has replaced it. */
  const settle = useCallback((ask: Ask, approved: boolean) => {
    if (pending.current !== ask) return
    pending.current = null
    returnFocus.current = ask.invoker
    setOpen(false)
    ask.resolve(approved)
  }, [])

  // The action waiting for an answer belonged to the person and workspace that were signed in.
  useEffect(() => {
    current.current = identity
    return () => {
      if (!pending.current) return
      pending.current.invoker = null // the page changed under it: focus is not taken back
      settle(pending.current, false)
    }
  }, [identity, settle])

  const approve = useMutation<{ data: HeidiConsent }, Error, { ask: Ask; version: string }>({
    mutationFn: ({ version }) => heidiApi.setConsent(true, version),
    onSuccess: ({ data }, { ask }) => {
      // A late answer for a question already dropped (Not now, another workspace) changes nothing here.
      if (pending.current !== ask || current.current !== ask.identity) return
      queryClient.setQueryData<HeidiUsage>(
        usageKey,
        (usage) => usage && { ...usage, consent: data },
      )
      void queryClient.invalidateQueries({ queryKey: usageKey })
      settle(ask, true)
    },
    onError: (error) => {
      if (!isVersionChanged(error)) return void toast.error(errorMessage(error))
      // Never approved on the person's behalf: the new text is shown and they decide again.
      setChanged(true)
      void queryClient.invalidateQueries({ queryKey: consentKey })
    },
  })

  const ensure = useCallback(async () => {
    if (checking.current) return false // the first action waits for its answer; a second never runs behind it
    checking.current = true
    try {
      const asked = current.current
      const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const cached = queryClient.getQueryData<HeidiUsage>(usageKey)
      let usage: HeidiUsage
      try {
        // A cached "not yet" may be stale (approved in another tab), so it is asked again; so is a "yes" a refusal
        // has invalidated (withdrawn elsewhere, or a new notice since).
        usage =
          cached?.consent?.granted && !queryClient.getQueryState(usageKey)?.isInvalidated
            ? cached
            : await queryClient.fetchQuery({
                queryKey: usageKey,
                queryFn: heidiApi.usage,
                staleTime: 0,
              })
      } catch (error) {
        // A cancelled check (a workspace switch resets every query) or another identity by now drops the action;
        // any other failure lets the server decide and say why.
        return !isCancelledError(error) && current.current === asked
      }
      if (current.current !== asked) return false
      if (!usage.provider_available || usage.consent?.granted) return true
      return await new Promise<boolean>((resolve) => {
        pending.current = { resolve, identity: asked, invoker }
        setChanged(false)
        setOpen(true)
      })
    } finally {
      checking.current = false
    }
  }, [queryClient])

  const value = useMemo(() => ({ ensure }), [ensure])
  const text = notice.data?.notice

  return (
    <Context.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !approve.isPending && pending.current) settle(pending.current, false)
        }}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
          // Until the notice arrives there is no lead to describe the dialog.
          {...(text ? {} : { 'aria-describedby': undefined })}
          // The dialog has no trigger: focus goes back to whatever asked, if it is still on the page.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const invoker = returnFocus.current
            returnFocus.current = null
            if (invoker?.isConnected) invoker.focus()
          }}
        >
          <DialogHeader className="flex-row items-start gap-3 text-left">
            <IconTile icon={Sparkles} variant="heidi" size="lg" />
            <div className="grid gap-1">
              <DialogTitle>
                {text?.title ??
                  translate(notice.isError ? 'aiApprovalLoadFailed' : 'aiApprovalLoading')}
              </DialogTitle>
              {text && <DialogDescription>{text.lead}</DialogDescription>}
            </div>
          </DialogHeader>
          {changed && text && (
            <output className="block">
              <Callout tone="warning">{translate('aiApprovalChanged')}</Callout>
            </output>
          )}
          {text ? (
            text.sections.map((section) => (
              <section key={section.id} aria-label={section.title} className="grid gap-2">
                <h3 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
                  {section.title}
                </h3>
                <ul className="grid gap-2.5 rounded-lg bg-muted/50 p-3 text-body-sm">
                  {section.points.map((point) => {
                    const Icon = ICONS[point.id] ?? Info
                    return (
                      <li key={point.id} className="flex items-start gap-2.5">
                        <Icon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 stroke-[1.75] text-muted-foreground"
                        />
                        <span className="text-pretty">{point.text}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          ) : notice.isError ? (
            <Callout
              tone="danger"
              role="alert"
              actions={
                <Button variant="outline" size="sm" onClick={() => void notice.refetch()}>
                  {translate('tryAgain')}
                </Button>
              }
            >
              {errorMessage(notice.error)}
            </Callout>
          ) : (
            <Loader label={translate('aiApprovalLoading')} />
          )}
          <a
            href={siteUrl('/privacy#4-heidi-ai-import-and-openai')}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {translate('aiApprovalPrivacyLink')}
          </a>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={approve.isPending}
              onClick={() => pending.current && settle(pending.current, false)}
            >
              {translate('aiApprovalNotNow')}
            </Button>
            <Button
              disabled={approve.isPending || !text || notice.isFetching}
              onClick={() =>
                pending.current &&
                text &&
                approve.mutate({ ask: pending.current, version: text.version })
              }
            >
              {approve.isPending
                ? translate('aiApprovalApproving')
                : translate('aiApprovalApprove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  )
}
