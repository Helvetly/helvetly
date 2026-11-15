import Link from 'next/link'

import type { Question } from '@/components/faq'
import { translate } from '@/lib/i18n'
import { bytes, count, LIMITS, MAX_SELF_SERVICE_SEATS, plansWith, TRIAL } from '@/lib/plans'

const ai = LIMITS.ai_tokens_per_month.values
const actions = LIMITS.automation_actions_per_month.values
const millions = (n: number | null) =>
  translate('offerMillions', { count: count((n ?? 0) / 1_000_000) })

export const GENERAL_FAQ: Question[] = [
  {
    q: translate('whoIsHelvetlyFor'),
    a: translate('swissCompaniesAndThePeopleWhoRunThemFrom'),
  },
  {
    q: translate('doesItCreateRealSwissQRBills'),
    a: translate('yesEveryInvoiceCanCarryTheQRBillWith'),
  },
  {
    q: translate('canHelvetlyFileMyVATReturn'),
    a: translate('withHelvetlyPreparesItTheFiguresPerZifferA', {
      value1: plansWith('corrections_vat'),
    }),
  },
  {
    q: translate('whatDoesHeidiDoWithMyData'),
    a: (
      <>
        {translate('offerHeidiDataDetails', { plans: plansWith('heidi', 'conjunction') })}
        <Link href="/privacy">{translate('privacyPolicy')}</Link>
        {translate('andThe3')}
        <Link href="/subprocessors">{translate('listOfSubprocessors')}</Link>.
      </>
    ),
  },
  {
    q: translate('canIMoveMyExistingDataIn'),
    a: translate('yesUploadPDFsImagesSpreadsheetsWordFilesOrA2', { value1: plansWith('expenses') }),
  },
  {
    q: translate('whatHappensIfIStopPaying'),
    a: translate('yourWorkspaceBecomesReadOnlyNothingIsDeletedYou'),
  },
]

export const PRICING_FAQ: Question[] = [
  {
    q: translate('howDoesTheTrialWork'),
    a: translate('tryBusinessForDaysWithUpToTeamMembers', {
      days: TRIAL.days,
      members: TRIAL.members,
      invoices: TRIAL.invoices,
      expenses: TRIAL.expenses,
      signatures: TRIAL.signatures,
      value6: bytes(TRIAL.storageBytes),
      value7: count(TRIAL.aiTokens),
      automationActions: TRIAL.automationActions,
    }),
  },
  {
    q: translate('arePricesPerPerson'),
    a: translate('yesEveryTeamMemberOwnersAdminsMembersAccountantsAnd', {
      MAX_SELF_SERVICE_SEATS: MAX_SELF_SERVICE_SEATS,
    }),
  },
  {
    q: translate('isVATIncluded'),
    a: translate('yesPricesAreInCHFInSwitzerlandAndLiechtenstein'),
  },
  {
    q: translate('howDoTheAllowancesWork'),
    a: translate('clientsProductsAndEngagementsAreFixedCapsForThe'),
  },
  {
    q: translate('whatHappensWhenIReachALimit'),
    a: translate('nothingIsChargedExtraAndNothingIsDeletedOnly'),
  },
  {
    q: translate('whatAreAITokens'),
    a: translate('yourWorkspaceSharesTheAITokensContributedByEach', {
      value1: count(ai.basic ?? 0),
      value2: plansWith('heidi'),
      value3: millions(ai.pro),
      value4: millions(ai.business),
    }),
  },
  {
    q: translate('whatCountsAsAnAutomationAction'),
    a: translate('proIncludesAndBusinessActionsPerPaidPersonA', {
      value1: count(actions.pro ?? 0),
      value2: count(actions.business ?? 0),
    }),
  },
  {
    q: translate('howDoesTheRevolutPaymentLinkWork'),
    a: translate('itAddsYourRevolutMeLinkAndQRCode'),
  },
  {
    q: translate('whichPlanDoVATReturnsAndCorrectionsNeed'),
    a: translate('vatIsCalculatedOnInvoicesInEveryPlanPreparing', {
      value1: plansWith('corrections_vat'),
      value2: plansWith('corrections_vat'),
    }),
  },
  {
    q: translate('whatKindOfSignaturesAndEInvoicesAreThese'),
    a: translate('simpleElectronicSignaturesWithQualifiedSignaturesAreNotIncluded', {
      value1: plansWith('templates_signatures'),
      value2: plansWith('einvoice_xml'),
    }),
  },
  {
    q: translate('canIExportMyData'),
    a: translate('exportClientProductAndOtherBusinessDataPlusSupported', {
      value1: plansWith('ledger_exports'),
      value2: plansWith('einvoice_xml'),
    }),
  },
  {
    q: translate('canIChangePlansLater'),
    a: translate('anyTimeFromTheWorkspaceSettingsASmallerPlan'),
  },
  {
    q: translate('doINeedSeveralPlansForSeveralCompanies'),
    a: translate('eachCompanyGetsItsOwnWorkspaceWithItsOwn'),
  },
]
