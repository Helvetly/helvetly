'use client'
import { localizedHref } from '@helvetly/i18n'
import { Button } from '@helvetly/ui/components/button'
import { BookOpen, Bot, Braces } from 'lucide-react'

import { Snippet } from '@/components/developers/snippet'
import { SettingsPage, SettingsSection } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { useApiOrigin } from '@/lib/api-origin'
import { docsUrl } from '@/lib/docs'
import { translate } from '@/lib/i18n'

import { ApiTokens } from './api-tokens'
import { DocsLink } from './code-block'
import { McpConnect } from './mcp-connect'

/** Settings → API & MCP: personal tokens, the REST API and connecting an AI assistant. */
export function ApiSettings() {
  const origin = useApiOrigin()
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title={translate('apiMCP')}
        description={translate('connectYourOwnScriptsAndAIAssistantsToHelvetly')}
        actions={
          <Button asChild size="sm" variant="outline">
            <a href={localizedHref(docsUrl())} target="_blank" rel="noreferrer">
              <BookOpen />
              {translate('developerDocs')}
              <span className="sr-only">{translate('opensInANewTab')}</span>
            </a>
          </Button>
        }
      >
        <ApiTokens />
        <SettingsSection
          id="mcp"
          icon={Bot}
          title={translate('connectAnAIAssistant')}
          description={
            <>
              {translate('claudeCursorAndOtherAssistantsCanUseHelvetlyThrough')}{' '}
              <DocsLink path="/mcp">{translate('mcpGuide')}</DocsLink>
            </>
          }
        >
          <McpConnect origin={origin} />
        </SettingsSection>
        <SettingsSection
          id="rest-api"
          icon={Braces}
          title={translate('restAPI')}
          description={
            <>
              {translate('jsonOverHTTPSTheSameOperationsAsTheMCP')}
              <DocsLink>{translate('apiReference')}</DocsLink>
            </>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <p className="text-body-sm font-medium">{translate('baseURL')}</p>
              <Snippet label={translate('baseURL')} value={`${origin}/api/v1`} />
            </div>
            <div className="grid gap-1.5">
              <p className="text-body-sm font-medium">{translate('firstRequest')}</p>
              <Snippet
                label={translate('exampleRequest')}
                value={`curl ${origin}/api/v1/clients -H "Authorization: Bearer hvt_YOUR_TOKEN"`}
              />
            </div>
          </div>
        </SettingsSection>
      </SettingsPage>
    </>
  )
}
