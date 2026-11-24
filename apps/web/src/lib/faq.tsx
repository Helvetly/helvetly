import { publicHref } from '@helvetly/i18n/public-href'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { type MessageKey, perLanguage } from '@/lib/i18n'
import { plansIn, SELF_SERVICE_SEATS, TRIAL } from '@/lib/plans'

/** The topics the FAQ page groups its questions under, in page order, with their headings. */
export const TOPICS = {
  start: 'faqTopicStart',
  billing: 'faqTopicBilling',
  limits: 'faqTopicLimits',
  swiss: 'faqTopicSwiss',
  data: 'faqTopicData',
} satisfies Record<string, MessageKey>

export type Topic = keyof typeof TOPICS

/** `id` is the question's anchor on the FAQ page, the same in every language. */
export type Question = {
  id: string
  topic: Topic
  teaser?: 'home' | 'pricing'
  q: string
  a: ReactNode
}

/**
 * Every question, in one language. Each one is listed once: `topic` places it on the FAQ page and
 * `teaser` also puts it in the short list on the home or the pricing page.
 */
export const faqIn = perLanguage((translate, language) => {
  const { count, plansWith, tokens, value } = plansIn(language)

  const FAQ: Question[] = [
    {
      id: 'who-is-it-for',
      topic: 'start',
      teaser: 'home',
      q: translate('whoIsHelvetlyFor'),
      a: translate('swissCompaniesAndThePeopleWhoRunThemFrom'),
    },
    {
      id: 'qr-bills',
      topic: 'swiss',
      teaser: 'home',
      q: translate('doesItCreateRealSwissQRBills'),
      a: translate('yesEveryInvoiceCanCarryTheQRBillWith'),
    },
    {
      id: 'vat-return',
      topic: 'swiss',
      teaser: 'home',
      q: translate('canHelvetlyFileMyVATReturn'),
      a: translate('withHelvetlyPreparesItTheFiguresPerZifferA', {
        value1: plansWith('corrections_vat'),
      }),
    },
    {
      id: 'heidi-and-your-data',
      topic: 'data',
      teaser: 'home',
      q: translate('whatDoesHeidiDoWithMyData'),
      a: (
        <>
          {translate('offerHeidiDataDetails', { plans: plansWith('heidi', 'conjunction') })}
          <Link href={publicHref('/privacy', language)}>{translate('privacyPolicy')}</Link>
          {translate('andThe3')}
          <Link href={publicHref('/subprocessors', language)}>
            {translate('listOfSubprocessors')}
          </Link>
          .
        </>
      ),
    },
    {
      id: 'move-your-data-in',
      topic: 'start',
      teaser: 'home',
      q: translate('canIMoveMyExistingDataIn'),
      a: translate('yesUploadPDFsImagesSpreadsheetsWordFilesOrA2', {
        value1: plansWith('expenses'),
      }),
    },
    {
      id: 'stop-paying',
      topic: 'billing',
      teaser: 'home',
      q: translate('whatHappensIfIStopPaying'),
      a: translate('yourWorkspaceBecomesReadOnlyNothingIsDeletedYou'),
    },
    {
      id: 'trial',
      topic: 'start',
      teaser: 'pricing',
      q: translate('howDoesTheTrialWork'),
      a: translate('tryProForDaysWithUpToTeamMembers', {
        days: TRIAL.days,
        members: TRIAL.members,
      }),
    },
    {
      id: 'price-per-person',
      topic: 'billing',
      teaser: 'pricing',
      q: translate('arePricesPerPerson'),
      a: translate('yesEveryTeamMemberOwnersAdminsMembersAccountantsAnd', {
        MAX_SELF_SERVICE_SEATS: SELF_SERVICE_SEATS.pro, // Basic's 5 is written in the answer; a test keeps both in step
      }),
    },
    {
      id: 'vat-included',
      topic: 'billing',
      teaser: 'pricing',
      q: translate('isVATIncluded'),
      a: translate('yesPricesAreInCHFInSwitzerlandAndLiechtenstein'),
    },
    {
      id: 'allowances',
      topic: 'limits',
      teaser: 'pricing',
      q: translate('howDoTheAllowancesWork'),
      a: translate('clientsProductsAndEngagementsAreFixedCapsForThe'),
    },
    {
      id: 'reaching-a-limit',
      topic: 'limits',
      teaser: 'pricing',
      q: translate('whatHappensWhenIReachALimit'),
      a: translate('nothingIsChargedExtraAndNothingIsDeletedOnly'),
    },
    {
      id: 'ai-tokens',
      topic: 'limits',
      teaser: 'pricing',
      q: translate('whatAreAITokens'),
      a: translate('yourWorkspaceSharesTheAITokensContributedByEach', {
        value2: plansWith('heidi'),
        value3: tokens(value('ai_tokens_per_month', 'pro')),
        value4: tokens(value('ai_tokens_per_month', 'business')),
      }),
    },
    {
      id: 'automation-actions',
      topic: 'limits',
      q: translate('whatCountsAsAnAutomatedAction'),
      a: translate('proIncludesAndBusinessAutomatedActionsPerTeamMember', {
        value1: count(value('automation_actions_per_month', 'pro')),
        value2: count(value('automation_actions_per_month', 'business')),
      }),
    },
    {
      id: 'revolut-payment-link',
      topic: 'swiss',
      q: translate('howDoesTheRevolutPaymentLinkWork'),
      a: translate('itAddsYourRevolutMeLinkAndQRCode'),
    },
    {
      id: 'vat-returns-plan',
      topic: 'swiss',
      q: translate('whichPlanDoVATReturnsAndCorrectionsNeed'),
      a: translate('vatIsCalculatedOnInvoicesInEveryPlanPreparing', {
        value1: plansWith('corrections_vat'),
        value2: plansWith('corrections_vat'),
      }),
    },
    {
      id: 'signatures-and-e-invoices',
      topic: 'swiss',
      q: translate('whatKindOfSignaturesAndEInvoicesAreThese'),
      a: translate('simpleElectronicSignaturesWithQualifiedSignaturesAreNotIncluded', {
        value1: plansWith('templates_signatures'),
        value2: plansWith('einvoice_xml'),
      }),
    },
    {
      id: 'export-your-data',
      topic: 'data',
      q: translate('canIExportMyData'),
      a: translate('exportClientProductAndOtherBusinessDataPlusSupported', {
        value1: plansWith('ledger_exports'),
        value2: plansWith('einvoice_xml'),
      }),
    },
    {
      id: 'change-plans',
      topic: 'billing',
      q: translate('canIChangePlansLater'),
      a: translate('anyTimeFromTheWorkspaceSettingsASmallerPlan'),
    },
    {
      id: 'several-companies',
      topic: 'billing',
      q: translate('doINeedSeveralPlansForSeveralCompanies'),
      a: translate('eachCompanyGetsItsOwnWorkspaceWithItsOwn'),
    },
  ]
  return FAQ
})
