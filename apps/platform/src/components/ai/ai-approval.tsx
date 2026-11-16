'use client'
import { Button } from '@helvetly/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@helvetly/ui/components/dialog'
import { isCancelledError, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Globe, GraduationCap, MessageSquare, Paperclip, ShieldOff } from 'lucide-react'
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
import { heidiApi, usageKey, type HeidiConsent, type HeidiUsage } from '@/lib/heidi'
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

const POINTS = [
  { icon: MessageSquare, key: 'aiApprovalSentMessages' },
  { icon: Paperclip, key: 'aiApprovalSentFiles' },
  { icon: ShieldOff, key: 'aiApprovalNotSent' },
  { icon: GraduationCap, key: 'aiApprovalNoTraining' },
  { icon: Clock, key: 'aiApprovalRetention' },
  { icon: Globe, key: 'aiApprovalProcessedIn' },
] as const

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

  const approve = useMutation<{ data: HeidiConsent }, Error, Ask>({
    mutationFn: () => heidiApi.setConsent(true),
    onSuccess: ({ data }, ask) => {
      // A late answer for a question already dropped (Not now, another workspace) changes nothing here.
      if (pending.current !== ask || current.current !== ask.identity) return
      queryClient.setQueryData<HeidiUsage>(
        usageKey,
        (usage) => usage && { ...usage, consent: data },
      )
      void queryClient.invalidateQueries({ queryKey: usageKey })
      settle(ask, true)
    },
    onError: (error) => toast.error(errorMessage(error)),
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
        // A cached "not yet" may be stale (approved in another tab), so it is asked again.
        usage = cached?.consent?.granted
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
        setOpen(true)
      })
    } finally {
      checking.current = false
    }
  }, [queryClient])

  const value = useMemo(() => ({ ensure }), [ensure])

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
          className="sm:max-w-md"
          // The dialog has no trigger: focus goes back to whatever asked, if it is still on the page.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const invoker = returnFocus.current
            returnFocus.current = null
            if (invoker?.isConnected) invoker.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{translate('aiApprovalTitle')}</DialogTitle>
            <DialogDescription>{translate('aiApprovalBody')}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2.5 text-body-sm">
            {POINTS.map(({ icon: Icon, key }) => (
              <li key={key} className="flex items-start gap-2.5">
                <Icon
                  aria-hidden
                  className="mt-px size-4 shrink-0 stroke-[1.75] text-muted-foreground"
                />
                <span>{translate(key)}</span>
              </li>
            ))}
          </ul>
          <a
            href={siteUrl('/privacy#4-heidi-ai-import-and-openai')}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-caption underline underline-offset-2 hover:text-foreground"
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
              disabled={approve.isPending}
              onClick={() => pending.current && approve.mutate(pending.current)}
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
