'use client'

import { Button } from '@helvetly/ui/components/button'
import { BookOpen, Bot, Braces } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Snippet } from '@/components/developers/snippet'
import { SettingsPage, SettingsSection } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { docsUrl } from '@/lib/docs'

import { ApiTokens } from './api-tokens'
import { DocsLink } from './code-block'
import { McpConnect } from './mcp-connect'

const noSubscribe = () => () => {}
/** The app's own origin, which serves the API and the MCP server (same origin, AGENTS.md). */
const useOrigin = () =>
  useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => '',
  )

/** Settings → API & MCP: personal tokens, the REST API and connecting an AI assistant. */
export function ApiSettings() {
  const origin = useOrigin()
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="API & MCP"
        description="Connect your own scripts and AI assistants to Helvetly. Tokens are yours: they follow you, not the workspace, and each acts in the workspace it was created in."
        actions={
          <Button asChild size="sm" variant="outline">
            <a href={docsUrl()} target="_blank" rel="noreferrer">
              <BookOpen /> Developer docs <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        }
      >
        <ApiTokens />
        <SettingsSection
          id="mcp"
          icon={Bot}
          title="Connect an AI assistant"
          description={
            <>
              Claude, Cursor and other assistants can use Helvetly through MCP: they look up clients
              and invoices and, with a write token, create them for you.{' '}
              <DocsLink path="/mcp">MCP guide</DocsLink>
            </>
          }
        >
          <McpConnect origin={origin} />
        </SettingsSection>
        <SettingsSection
          id="rest-api"
          icon={Braces}
          title="REST API"
          description={
            <>
              JSON over HTTPS, the same operations as the MCP tools. Send the token in the
              Authorization header. <DocsLink>API reference</DocsLink>
            </>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <p className="text-body-sm font-medium">Base URL</p>
              <Snippet label="Base URL" value={`${origin}/api/v1`} />
            </div>
            <div className="grid gap-1.5">
              <p className="text-body-sm font-medium">First request</p>
              <Snippet
                label="Example request"
                value={`curl ${origin}/api/v1/clients -H "Authorization: Bearer hvt_YOUR_TOKEN"`}
              />
            </div>
          </div>
        </SettingsSection>
      </SettingsPage>
    </>
  )
}
