import { publicHref } from '@helvetly/i18n/public-href'
import { formatPrice } from '@helvetly/ui/lib/price'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { type MessageKey, perLanguage } from '@/lib/i18n'
import { extraPersonOf, type Plan, plansIn, priceOf, SELF_SERVICE_SEATS, TRIAL } from '@/lib/plans'

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

const month = (plan: Plan) => formatPrice(priceOf(plan, 'month'))
const extra = (plan: Plan) => formatPrice(extraPersonOf(plan, 'month'))

/**
 * Every question, in one language. Each one is listed once: `topic` places it on the FAQ page and
 * `teaser` also puts it in the short list on the home or the pricing page.
 */
export const faqIn = perLanguage((translate, language) => {
  const { count, planById, plansWith, tokens, value } = plansIn(language)
  const free = planById('free')
  const basic = planById('basic')
  const pro = planById('pro')
  const business = planById('business')

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
        value1: plansWith('ai_import'),
      }),
    },
    {
      id: 'stop-paying',
      topic: 'billing',
      teaser: 'home',
      q: translate('whatHappensIfIStopPaying'),
      a: translate('yourWorkspaceMovesToFreeNothingIsDeleted', { free: free.name }),
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
      id: 'free-plan',
      topic: 'billing',
      teaser: 'pricing',
      q: translate('isThereAFreePlan'),
      a: translate('yesFreeIsFreeForeverForOnePerson', {
        free: free.name,
        basic: basic.name,
        aiImport: plansWith('ai_import'),
        noBranding: plansWith('remove_branding', 'conjunction'),
      }),
    },
    {
      id: 'price-per-person',
      topic: 'billing',
      teaser: 'pricing',
      q: translate('howDoPeopleAffectThePrice'),
      a: translate('eachPlanIncludesPeopleAndEachFurtherPersonAdds', {
        free: free.name,
        basic: basic.name,
        pro: pro.name,
        business: business.name,
        basicPrice: month(basic),
        proPrice: month(pro),
        businessPrice: month(business),
        basicPeople: basic.includedPeople,
        proPeople: pro.includedPeople,
        businessPeople: business.includedPeople,
        basicExtra: extra(basic),
        proExtra: extra(pro),
        businessExtra: extra(business),
        basicMax: SELF_SERVICE_SEATS.basic ?? '',
        proMax: SELF_SERVICE_SEATS.pro ?? '',
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
